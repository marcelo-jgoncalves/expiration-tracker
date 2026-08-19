/**
 * Reconciliation - implementation-blueprint.md §9.5, run as ONE job/Lambda serving TWO
 * purposes (per the task brief: "don't build two separate reconciliation paths"), both
 * documented in §9.3 point 4 ("claims expirados... via reconciliação, mesmo job da §9.5")
 * and §9.5 itself (DST):
 *
 *  (a) claim-expiry reconciliation: any occurrence still CLAIMED past its
 *      `claimExpiresAt` (dispatch worker crashed/timed out before completing) reverts to
 *      SCHEDULED, conditionally, so the next producer tick's lookback window picks it up
 *      again;
 *  (b) DST-affected re-evaluation (§9.5 steps 1-6): for each (item, enabled policy) pair
 *      in the reconciliation batch, recompute the expected schedule from the policy's
 *      IANA timeZone + rule against a `[now, now+7d]` window, compare to what's actually
 *      materialized, cancel divergent SCHEDULED occurrences and materialize missing ones
 *      idempotently - TRIGGERED/ACKED history is never touched.
 *
 * Both passes reuse the same store/materializer/clock and are invoked together by
 * `runReconciliation`, in the order claim-expiry -> DST (claim-expiry is cheaper and
 * unblocks the producer sooner).
 */
import { buildVersionedUpdate } from "../../shared/dynamodb/occ.js";
import { isTransactionCanceled, type ReminderStore } from "../../modules/reminder/ports/reminder-store.js";
import { ReminderMaterializer } from "../../modules/reminder/application/reminder-materializer.js";
import type { ReminderOccurrence } from "../../modules/reminder/domain/reminder-occurrence.js";
import type { ReminderPolicy } from "../../modules/reminder/domain/reminder-policy.js";
import type { ShardConfig } from "../../modules/reminder/domain/shard-config.js";

export interface ReconciliationDeps {
  store: ReminderStore;
  tableName: string;
  now: () => string;
  shardConfig: ShardConfig;
}

/** One (item, active policy) pair the DST pass evaluates. In production this batch comes
 * from a GSI6-style "active reminder policies" index (left as infra follow-up, see report
 * - M3's scope per the task brief is the reconciliation MECHANISM, not that index's
 * wiring); tests/callers supply the batch directly. */
export interface DstReconciliationCandidate {
  tenantId: string;
  itemId: string;
  itemVersion: number;
  itemDueDate: string;
  policy: ReminderPolicy;
}

export interface ReconciliationResult {
  claimsReverted: number;
  dstCancelled: number;
  dstCreated: number;
  dstDivergences: number;
}

/** Pass (a): any CLAIMED occurrence whose claimExpiresAt is in the past reverts to SCHEDULED. */
export async function reconcileExpiredClaims(
  deps: ReconciliationDeps,
  candidateOccurrences: ReminderOccurrence[],
): Promise<number> {
  let reverted = 0;
  const now = deps.now();
  for (const occurrence of candidateOccurrences) {
    if (occurrence.status !== "CLAIMED") continue;
    if (!occurrence.claimExpiresAt || occurrence.claimExpiresAt > now) continue;
    try {
      await deps.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key: { PK: occurrence.PK, SK: occurrence.SK },
            tenantId: occurrence.tenantId,
            expectedVersion: occurrence.version,
            set: { status: "SCHEDULED" },
            // M3.5: this claim is resolved (reverted) - its WORKSTATE#CLAIMED GSI6 pointer
            // must go too, or the next reconciliation pass would find it again forever.
            remove: ["GSI6PK", "GSI6SK"],
          }),
        },
      ]);
      reverted += 1;
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
    }
  }
  return reverted;
}

/** Pass (b): DST-affected re-evaluation over `[now, now+7d]` (§9.5 steps 1-6). */
export async function reconcileDst(
  deps: ReconciliationDeps,
  candidates: DstReconciliationCandidate[],
): Promise<{ cancelled: number; created: number; divergences: number }> {
  const materializer = new ReminderMaterializer(deps.store, deps.tableName, deps.now);
  const windowStart = Date.parse(deps.now());
  const windowEnd = windowStart + 7 * 24 * 60 * 60_000;

  let cancelled = 0;
  let created = 0;
  let divergences = 0;

  for (const candidate of candidates) {
    if (!candidate.policy.enabled) continue;

    const existing = await deps.store.queryByItem<ReminderOccurrence>(candidate.tenantId, candidate.itemId);
    const liveExisting = existing.filter(
      (o) =>
        o.policyId === candidate.policy.policyId &&
        o.itemVersion === candidate.itemVersion &&
        o.policyVersion === candidate.policy.version &&
        (o.status === "SCHEDULED" || o.status === "CLAIMED"),
    );

    // Expected schedule per trigger, recomputed fresh from the IANA rule (never a frozen offset).
    const expectedByTrigger = new Map<string, { scheduledAtUtc: string }>();
    for (const trigger of candidate.policy.triggers) {
      const schedule = materializer.computeSchedule({
        itemDueDate: candidate.itemDueDate,
        offsetIso: trigger.offsetIso,
        localTime: trigger.localTime,
        timeZone: candidate.policy.timeZone,
        quietHours: candidate.policy.quietHours,
      });
      const t = Date.parse(schedule.scheduledAtUtc);
      if (t < windowStart || t > windowEnd) continue; // out of the 7-day reconciliation window
      expectedByTrigger.set(trigger.triggerId, { scheduledAtUtc: schedule.scheduledAtUtc });
    }

    // Cancel occurrences whose triggerId is no longer expected, or whose scheduledAt now
    // diverges from a fresh DST-aware recomputation (history TRIGGERED/ACKED untouched -
    // liveExisting already excludes those statuses).
    for (const occurrence of liveExisting) {
      const expected = expectedByTrigger.get(occurrence.triggerId);
      const diverges = !expected || expected.scheduledAtUtc !== occurrence.scheduledAt;
      if (!diverges) {
        // M3.5 (bug found by Codex implementation review - the original code left
        // WORKSTATE#DST_PENDING pointers in place forever whenever recomputation confirmed
        // the schedule was still correct, so confirmed-correct occurrences were
        // re-evaluated on every single daily run indefinitely). The window is processed for
        // this occurrence either way - clear the pointer once confirmed, not only on
        // cancellation.
        if (occurrence.GSI6PK) {
          try {
            await deps.store.transactWrite([
              {
                Update: buildVersionedUpdate({
                  tableName: deps.tableName,
                  key: { PK: occurrence.PK, SK: occurrence.SK },
                  tenantId: candidate.tenantId,
                  expectedVersion: occurrence.version,
                  set: {},
                  remove: ["GSI6PK", "GSI6SK"],
                }),
              },
            ]);
          } catch (err) {
            if (!isTransactionCanceled(err)) throw err; // lost a race - fine, not our job to force it
          }
        }
        continue;
      }
      divergences += 1;
      try {
        await deps.store.transactWrite([
          {
            Update: buildVersionedUpdate({
              tableName: deps.tableName,
              key: { PK: occurrence.PK, SK: occurrence.SK },
              tenantId: candidate.tenantId,
              expectedVersion: occurrence.version,
              set: { status: "CANCELLED" },
              remove: ["GSI6PK", "GSI6SK"],
            }),
          },
        ]);
        cancelled += 1;
      } catch (err) {
        if (!isTransactionCanceled(err)) throw err;
      }
    }

    // Materialize any expected trigger missing a live (SCHEDULED/CLAIMED) occurrence -
    // materialize() itself is idempotent (putIfAbsent keyed by the deterministic
    // occurrenceId hash), so re-running it for triggers that already matched is a safe no-op.
    const stillMissing = candidate.policy.triggers.some((t) => {
      const expected = expectedByTrigger.get(t.triggerId);
      if (!expected) return false;
      return !liveExisting.some((o) => o.triggerId === t.triggerId && o.scheduledAt === expected.scheduledAtUtc);
    });
    if (stillMissing) {
      const result = await materializer.materialize({
        tenantId: candidate.tenantId,
        itemId: candidate.itemId,
        itemVersion: candidate.itemVersion,
        itemDueDate: candidate.itemDueDate,
        policy: candidate.policy,
        shardConfig: deps.shardConfig,
      });
      created += result.created.length;
    }
  }

  return { cancelled, created, divergences };
}

export async function runReconciliation(
  deps: ReconciliationDeps,
  input: { expiredClaimCandidates: ReminderOccurrence[]; dstCandidates: DstReconciliationCandidate[] },
): Promise<ReconciliationResult> {
  const claimsReverted = await reconcileExpiredClaims(deps, input.expiredClaimCandidates);
  const dst = await reconcileDst(deps, input.dstCandidates);
  return { claimsReverted, dstCancelled: dst.cancelled, dstCreated: dst.created, dstDivergences: dst.divergences };
}
