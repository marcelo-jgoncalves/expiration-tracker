/**
 * W3-07 purge orchestrator (D-124, implementing D-121's approved design — Rodada 2 Fix 5 plus
 * the durable-repair half of Fix 1).
 *
 * ONE recurring worker with TWO deliberately-unrelated responsibilities, folded together rather
 * than given a mechanism each — the approved design's explicit reasoning was that a third
 * recurring mechanism should not be invented when the sweeper already had to exist:
 *
 *  1. REPAIR (Fix 1's durable half). `CloseOrganizationService` calls `StartExecution`
 *     unconditionally on every invocation, which repairs the orphan case whenever the caller (or
 *     a retry of the same HTTP request) runs again — but nothing repairs the case where NO retry
 *     ever happens (browser closed, Lambda crashed outright). Any lifecycle record sitting in
 *     DELETING/QUIESCING/PURGING/VERIFIED whose `updatedAt` is older than one hour gets the same
 *     idempotent `StartExecution({name: tenantId})` again. One hour is comfortably past the
 *     already-approved 1800s quiescence bound (D-066), so this never fires against a healthy
 *     in-flight execution; when it does fire against one anyway, Step Functions' own name
 *     uniqueness makes it a no-op, which is why the starter port swallows `ExecutionAlreadyExists`.
 *
 *  2. POST-`DELETED` RESIDUAL VERIFICATION (D-066 Rodada H, 90-day window per `privacy-lgpd.md`).
 *     Re-runs the ALREADY-EXISTING `verifyTenant*Empty()` functions in isolation against tenants
 *     that already reached DELETED — no new verification logic is invented here, and nothing is
 *     deleted: this reports residue, it never re-opens a lifecycle record (DELETED is terminal,
 *     `tenant-lifecycle-record.ts`).
 *
 * Discovery for both halves is one `Scan` filtered to `SK = "LIFECYCLE"`. Explicit, accepted cost
 * tradeoff (not hidden): DynamoDB bills a Scan for every item read BEFORE the filter applies, so
 * this costs proportionally to total table size, not to the much smaller number of lifecycle
 * records. Accepted at this project's scale on the same proportionality argument `purgeTenant`'s
 * own Scan already makes; a sparse GSI keyed by lifecycle status is the named upgrade path and is
 * itself a separate level-5 decision, deliberately not smuggled in here.
 */
import type { TenantPurgeExecutionStarter } from "../../shared/tenant-lifecycle/tenant-purge-execution-starter.js";
import type { TenantPurgeExecutionDescriber } from "../../shared/tenant-lifecycle/tenant-purge-execution-describer.js";
import { transitionTenantLifecycle, SystemMutationConflictError, type SystemMutationStore } from "../../shared/tenant-lifecycle/system-mutation.js";
import type { TenantLifecycleRecord, TenantLifecycleStatus } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { verifyTenantDynamoPurgeEmpty, type DynamoTenantPurgeDeps } from "./dynamo-tenant-purge.js";
import { verifyTenantSessionsEmpty, type SessionTableTenantPurgeDeps } from "./session-table-tenant-purge.js";
import { verifyS3TenantPrefixEmpty, type S3TenantPurgeDeps } from "./s3-tenant-purge.js";
import type { TenantS3Target } from "./purge-tenant.js";

/** Statuses that mean "this tenant should have a live purge execution driving it". BLOCKED/HELD
 * are deliberately absent: those are stuck states awaiting a human operator, and re-launching an
 * execution for them would fight the remediation rather than help it. */
const IN_FLIGHT_STATUSES: ReadonlySet<TenantLifecycleStatus> = new Set(["DELETING", "QUIESCING", "PURGING", "VERIFIED"]);

/** Comfortably past D-066's already-approved 1800s quiescence cutoff — see file header. */
export const ORPHAN_REPAIR_THRESHOLD_MS = 60 * 60 * 1000;

/** `privacy-lgpd.md` / D-066 Rodada H — residual verification is bounded to the 90 days after a
 * tenant reached DELETED; past that the tombstone stays but nothing is re-verified. */
export const RESIDUAL_VERIFICATION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface TenantLifecycleScanPage {
  items: TenantLifecycleRecord[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface TenantLifecycleScanSource {
  /** `Scan` with `FilterExpression: SK = "LIFECYCLE"` — see file header for the cost tradeoff. */
  scanLifecycleRecords(exclusiveStartKey?: Record<string, unknown>): Promise<TenantLifecycleScanPage>;
}

export interface TenantPurgeSweepDeps {
  lifecycle: TenantLifecycleScanSource;
  executions: TenantPurgeExecutionStarter;
  /** D-127: only needed for the `HELD_FOR_RECOVERY` reconciliation branch below. */
  executionDescriber: TenantPurgeExecutionDescriber;
  store: SystemMutationStore;
  tableName: string;
  dynamo: Omit<DynamoTenantPurgeDeps, "onCheckpoint">;
  sessionTable: Omit<SessionTableTenantPurgeDeps, "onCheckpoint">;
  s3Source: S3TenantPurgeDeps["source"];
  /** Builds the same closed per-bucket target list `purgeTenant()` was given for this tenant —
   * supplied by the composition root so this worker stays agnostic of real bucket names. */
  s3TargetsFor: (tenantId: string) => TenantS3Target[];
  now?: () => Date;
}

export interface TenantPurgeSweepResult {
  lifecycleRecordsScanned: number;
  /** Tenants for which a repair `StartExecution` was issued (already-running ones included — the
   * starter swallows `ExecutionAlreadyExists`, so this counts attempts, not fresh launches). */
  executionsRepaired: number;
  /** Tenants inside the 90-day window whose residual verification ran. */
  tenantsVerified: number;
  /** Tenants whose residual verification found something still physically present — an
   * operator-visible signal, never auto-remediated here. */
  tenantsWithResidue: Array<{ tenantId: string; remainingDynamoItems: number; remainingSessions: number; remainingS3Objects: number }>;
  /** D-127: `HELD_FOR_RECOVERY` tenants for which this sweep pass completed a stalled
   * cancellation (StopExecution had already succeeded — execution is `ABORTED` for the exact
   * current `closureAttemptId` — but the `HELD_FOR_RECOVERY -> ACTIVE` write never committed,
   * e.g. `CancelOrganizationClosureService` crashed between the two steps). */
  cancellationsRepaired: string[];
  /** D-127: `HELD_FOR_RECOVERY` tenants whose execution state and lifecycle record disagree in a
   * way that is NOT the one safe-to-repair shape above — strict fail-closed: never restored,
   * always surfaced for an operator (`reason` names exactly what was ambiguous). */
  tenantsAmbiguous: Array<{ tenantId: string; reason: string }>;
}

export async function runTenantPurgeSweep(deps: TenantPurgeSweepDeps): Promise<TenantPurgeSweepResult> {
  const now = deps.now?.() ?? new Date();
  const result: TenantPurgeSweepResult = {
    lifecycleRecordsScanned: 0,
    executionsRepaired: 0,
    tenantsVerified: 0,
    tenantsWithResidue: [],
    cancellationsRepaired: [],
    tenantsAmbiguous: [],
  };

  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page: TenantLifecycleScanPage = await deps.lifecycle.scanLifecycleRecords(exclusiveStartKey);
    for (const record of page.items) {
      result.lifecycleRecordsScanned += 1;
      const ageMs = now.getTime() - Date.parse(record.updatedAt);

      if (record.status === "HELD_FOR_RECOVERY") {
        // D-127: deliberately NOT folded into the generic age-based orphan repair below — a
        // blind unconditional re-`StartExecution` here could race a cancellation that already
        // called `StopExecution` (that name becomes launchable again the instant Step Functions
        // finishes tearing the stopped execution down), silently restarting the 30-day clock
        // right as an OWNER is trying to cancel it. See `reconcileHeldForRecovery` for the
        // strict, execution-status-aware reconciliation this state gets instead.
        await reconcileHeldForRecovery(deps, record, result);
        continue;
      }

      if (IN_FLIGHT_STATUSES.has(record.status)) {
        if (ageMs > ORPHAN_REPAIR_THRESHOLD_MS) {
          // D-127: execution names are `${tenantId}-${closureAttemptId}` (not the bare tenantId)
          // since the quarantine mechanism introduced repeatable close/cancel/close cycles — a
          // record reaching DELETING+ always has a closureAttemptId (stamped when it entered
          // HELD_FOR_RECOVERY and never cleared on forward progress). The bare-tenantId fallback
          // is defensive only, for a hypothetical record that reached an in-flight state through
          // some path that never set it.
          const name = record.closureAttemptId ? `${record.tenantId}-${record.closureAttemptId}` : record.tenantId;
          await deps.executions.startExecution({ name, input: { tenantId: record.tenantId } });
          result.executionsRepaired += 1;
        }
        continue;
      }

      if (record.status === "DELETED" && ageMs <= RESIDUAL_VERIFICATION_WINDOW_MS) {
        result.tenantsVerified += 1;
        const targets = deps.s3TargetsFor(record.tenantId);
        const [dynamoVerify, sessionVerify, s3Verify] = await Promise.all([
          verifyTenantDynamoPurgeEmpty(deps.dynamo, record.tenantId),
          verifyTenantSessionsEmpty(deps.sessionTable, record.tenantId),
          Promise.all(targets.map((target) => verifyS3TenantPrefixEmpty({ source: deps.s3Source }, { bucket: target.bucket, prefix: target.prefix }))),
        ]);
        const remainingS3Objects = s3Verify.reduce((sum, v) => sum + v.remainingVersions + v.remainingMultipartUploads, 0);
        if (dynamoVerify.remainingItems > 0 || sessionVerify.remainingSessions > 0 || remainingS3Objects > 0) {
          result.tenantsWithResidue.push({
            tenantId: record.tenantId,
            remainingDynamoItems: dynamoVerify.remainingItems,
            remainingSessions: sessionVerify.remainingSessions,
            remainingS3Objects,
          });
        }
      }
    }
    exclusiveStartKey = page.lastEvaluatedKey;
  } while (exclusiveStartKey);

  return result;
}

/**
 * D-127 sweeper reconciliation for `HELD_FOR_RECOVERY` (round-7 of the approved design's
 * Claude<->Codex protocol, `docs/architecture/reviews/quarantine-retention-scoping/
 * round-7-claude-proposal.md` Fix 1 — the final, most conservative version, replacing an earlier
 * round's broader "FAILED/TIMED_OUT are also safe" claim that Codex correctly rejected).
 *
 * Restoration (completing a cancellation `CancelOrganizationClosureService` started but never
 * finished) requires ALL THREE, as a strict conjunction:
 *   1. The execution is `ABORTED` — the one status that is the DIRECT, DETERMINISTIC result of
 *      `StopExecution` succeeding before any purge `Task` ran to completion. No other terminal
 *      status has that property (`purgeTenant()` already models a `PARTIAL` outcome precisely
 *      because a workflow CAN do real, possibly-irreversible work before failing/timing out).
 *   2. The execution's own name embeds the CURRENT `record.closureAttemptId` — never restores
 *      against a stale attempt a later close/cancel/close cycle has already superseded.
 *   3. `record.status` is (re-)confirmed `HELD_FOR_RECOVERY` — nothing else already resolved it.
 *
 * Every other combination — `RUNNING` (the healthy, expected steady state during the 30-day
 * window: skipped, not ambiguous, no alarm) is NOT alarmed; but `FAILED`/`TIMED_OUT`/`SUCCEEDED`/
 * `NOT_FOUND`, or an `ABORTED` execution whose name does NOT match the current
 * `closureAttemptId` — alarms and NEVER restores. This is deliberately the more expensive branch:
 * given `HELD_FOR_RECOVERY` means nothing physical has purged yet in the overwhelmingly common
 * case, any non-`ABORTED` terminal status here is a genuinely unusual race that needs a human
 * with full information, not a sweeper guessing.
 */
async function reconcileHeldForRecovery(deps: TenantPurgeSweepDeps, record: TenantLifecycleRecord, result: TenantPurgeSweepResult): Promise<void> {
  if (!record.executionArn || !record.closureAttemptId) {
    // No execution was ever attached (e.g. CloseOrganizationService crashed before
    // attachTenantPurgeExecutionArn ran) — there is nothing to describe/reconcile yet. The
    // orphan-repair idiom (re-`StartExecution`, safe here because the name is unambiguous and
    // idempotent) is the right recovery, not an alarm: this is the ordinary "in-flight, needs its
    // execution (re)launched" case, just without an ARN recorded yet.
    const name = record.closureAttemptId ? `${record.tenantId}-${record.closureAttemptId}` : record.tenantId;
    await deps.executions.startExecution({ name, input: { tenantId: record.tenantId } });
    result.executionsRepaired += 1;
    return;
  }

  const execution = await deps.executionDescriber.describeExecution({ executionArn: record.executionArn });
  const expectedName = `${record.tenantId}-${record.closureAttemptId}`;

  if (execution.status === "RUNNING") {
    return; // healthy steady state, nothing to reconcile
  }

  const nameMatches = execution.name === expectedName;
  if (execution.status === "ABORTED" && nameMatches) {
    // Condition 3 of the conjunction (record.status still HELD_FOR_RECOVERY) is enforced by
    // transitionTenantLifecycle's own OCC + status-equality condition below, atomically, against
    // whatever is CURRENTLY stored — not by a separate read-then-check here, which would leave a
    // TOCTOU gap between re-reading and writing.
    try {
      await transitionTenantLifecycle({
        store: deps.store,
        tableName: deps.tableName,
        tenantId: record.tenantId,
        from: "HELD_FOR_RECOVERY",
        to: "ACTIVE",
        expectedVersion: record.version,
      });
      result.cancellationsRepaired.push(record.tenantId);
    } catch (err) {
      if (!(err instanceof SystemMutationConflictError)) throw err;
      // Something else already moved the record (e.g. the deadline fired and it is now
      // DELETING, or a concurrent sweeper/cancel call already completed this) — a benign race,
      // not an ambiguity worth alarming: the record's CURRENT state is authoritative and this
      // sweep pass simply lost the race to something else that resolved it correctly.
    }
    return;
  }

  result.tenantsAmbiguous.push({
    tenantId: record.tenantId,
    reason: `execution status "${execution.status}"${nameMatches ? "" : ` (name mismatch: expected "${expectedName}", got "${execution.name}")`} for closureAttemptId "${record.closureAttemptId}" — never auto-restoring, operator remediation required`,
  });
}
