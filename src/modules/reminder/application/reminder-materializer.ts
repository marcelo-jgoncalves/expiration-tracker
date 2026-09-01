/**
 * ReminderMaterializer — implementation-blueprint.md §9.1's `ReminderMaterializer`
 * interface + §9.2 (occurrence shape/GSI3 keys) + §8.3 (reacting to ItemDueDateChanged:
 * "Consumer do Reminder cancela ocorrências antigas por condição de versão... e
 * materializa as novas em lotes idempotentes. Evento repetido produz o mesmo resultado.").
 * Closes Red Team scenario 13 (stale reminders after a due-date edit).
 *
 * Idempotency (data-model.md §4): "tenantId|itemId|itemVersion|policyId|policyVersion|
 * triggerId|scheduledAtUtc". Judgment call: rather than a separate IdempotencyStore
 * record (M0's IdempotencyStore, used elsewhere for operations whose result isn't itself
 * a uniquely-keyed row), the occurrenceId is DERIVED deterministically from this exact
 * key (stableHash) and creation goes through ReminderStore.putIfAbsent's
 * attribute_not_exists(PK) condition - the occurrence row IS the idempotency record, same
 * pattern data-model.md §4 documents for WebhookInbox ("PK+SK já é a chave de
 * idempotência"). A retried/duplicated materialize() call computes the same occurrenceId
 * and its putIfAbsent no-ops.
 */
import {
  zonedTimeToUtc,
  toCalendarDate,
  addCalendarDays,
  parseDayOffset,
  parseLocalTime,
  timeZoneObservesDst,
} from "../domain/recurrence.js";
import { computeOccurrencePurgeAfterTtl, gsi3Keys, occurrenceKey, stableHash, type ReminderOccurrence } from "../domain/reminder-occurrence.js";
import { policyKey, type ReminderPolicy, type QuietHours } from "../domain/reminder-policy.js";
import type { ShardConfig } from "../domain/shard-config.js";
import { activeGenerations } from "../domain/shard-config.js";
import { buildVersionConditionCheck, buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { isTransactionCanceled, type ReminderStore } from "../ports/reminder-store.js";
import { GSI6PK_WORKSTATE_DST_PENDING, buildDstCandidateGsi6Sk } from "../ports/reconciliation-candidate-source.js";

export interface MaterializeInput {
  tenantId: string;
  itemId: string;
  itemVersion: number;
  itemDueDate: string; // ISO date or date-time
  policy: ReminderPolicy;
  shardConfig: ShardConfig;
}

export interface MaterializeResult {
  created: ReminderOccurrence[];
  skippedExisting: number;
}

function applyQuietHours(hour: number, minute: number, quietHours: QuietHours | undefined): { hour: number; minute: number } {
  if (!quietHours) return { hour, minute };
  const start = parseLocalTime(quietHours.startLocalTime);
  const end = parseLocalTime(quietHours.endLocalTime);
  const t = hour * 60 + minute;
  const s = start.hour * 60 + start.minute;
  const e = end.hour * 60 + end.minute;
  const inWindow = s <= e ? t >= s && t < e : t >= s || t < e; // handles windows crossing midnight
  if (!inWindow) return { hour, minute };
  return { hour: end.hour, minute: end.minute };
}

function toLocalIsoString(parts: { year: number; month: number; day: number; hour: number; minute: number }): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00`;
}

function idempotencyKey(input: {
  tenantId: string;
  itemId: string;
  itemVersion: number;
  policyId: string;
  policyVersion: number;
  triggerId: string;
  scheduledAtUtc: string;
}): string {
  return [
    input.tenantId,
    input.itemId,
    input.itemVersion,
    input.policyId,
    input.policyVersion,
    input.triggerId,
    input.scheduledAtUtc,
  ].join("|");
}

export class ReminderMaterializer {
  constructor(
    private readonly store: ReminderStore,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Computes the scheduledAt (UTC) + local wall-clock string for one trigger, given the item's dueDate. Pure - no I/O - exposed for unit testing DST edge cases directly. */
  computeSchedule(input: {
    itemDueDate: string;
    offsetIso: string;
    localTime: string;
    timeZone: string;
    quietHours?: QuietHours;
  }): { scheduledAtUtc: string; localScheduledAt: string; dstKind: "NORMAL" | "AMBIGUOUS" | "NONEXISTENT" } {
    const baseDate = toCalendarDate(input.itemDueDate);
    const offsetDays = parseDayOffset(input.offsetIso);
    const targetDate = addCalendarDays(baseDate, offsetDays);
    const { hour: rawHour, minute: rawMinute } = parseLocalTime(input.localTime);
    const { hour, minute } = applyQuietHours(rawHour, rawMinute, input.quietHours);

    const resolution = zonedTimeToUtc(
      { year: targetDate.year, month: targetDate.month, day: targetDate.day, hour, minute },
      input.timeZone,
    );

    return {
      scheduledAtUtc: new Date(resolution.utcMillis).toISOString(),
      localScheduledAt: toLocalIsoString({ ...targetDate, hour, minute }),
      dstKind: resolution.kind,
    };
  }

  /**
   * Materializes every trigger of `policy` for the given item/version. Idempotent: safe
   * to call repeatedly for the same (itemVersion, policyVersion) - existing occurrences
   * are left untouched (skippedExisting), only missing ones are created.
   */
  async materialize(input: MaterializeInput): Promise<MaterializeResult> {
    const created: ReminderOccurrence[] = [];
    let skippedExisting = 0;

    if (!input.policy.enabled) {
      return { created, skippedExisting };
    }

    const generation = activeGenerations(input.shardConfig, this.now())[0]!; // current generation

    for (const trigger of input.policy.triggers) {
      const schedule = this.computeSchedule({
        itemDueDate: input.itemDueDate,
        offsetIso: trigger.offsetIso,
        localTime: trigger.localTime,
        timeZone: input.policy.timeZone,
        quietHours: input.policy.quietHours,
      });

      const key = idempotencyKey({
        tenantId: input.tenantId,
        itemId: input.itemId,
        itemVersion: input.itemVersion,
        policyId: input.policy.policyId,
        policyVersion: input.policy.version,
        triggerId: trigger.triggerId,
        scheduledAtUtc: schedule.scheduledAtUtc,
      });
      const occurrenceId = `occ_${stableHash(key).toString(16)}`;

      const now = this.now();
      const gsi3 = gsi3Keys({
        tenantId: input.tenantId,
        occurrenceId,
        scheduledAt: schedule.scheduledAtUtc,
        shardCount: generation.shardCount,
      });

      // M3.5 (docs/architecture/m3.5-runtime-design.md §"Reconciliação"; broadened after
      // Codex's implementation review found the original AMBIGUOUS/NONEXISTENT-only trigger
      // too narrow): a GSI6 WORKSTATE#DST_PENDING pointer is set whenever EITHER the
      // schedule was computed at an ambiguous/nonexistent local time (dstKind !== "NORMAL")
      // OR the policy's timeZone observes DST at all in the occurrence's target year - a
      // plain 09:00 reminder in a DST-observing zone can still need re-evaluation after an
      // offset change even though its own computed instant was never ambiguous. Occurrences
      // in a fixed-offset timeZone (e.g. America/Sao_Paulo since 2019) never get the pointer.
      const dstRelevant =
        schedule.dstKind !== "NORMAL" || timeZoneObservesDst(input.policy.timeZone, toCalendarDate(schedule.scheduledAtUtc).year);
      const dstPending = dstRelevant
        ? {
            GSI6PK: GSI6PK_WORKSTATE_DST_PENDING,
            GSI6SK: buildDstCandidateGsi6Sk(schedule.scheduledAtUtc, input.tenantId, occurrenceId),
          }
        : {};

      const occurrence: ReminderOccurrence = {
        ...occurrenceKey(input.tenantId, input.itemId, schedule.scheduledAtUtc, occurrenceId),
        entityType: "ReminderOccurrence",
        occurrenceId,
        tenantId: input.tenantId,
        itemId: input.itemId,
        policyId: input.policy.policyId,
        triggerId: trigger.triggerId,
        scheduledAt: schedule.scheduledAtUtc,
        localScheduledAt: schedule.localScheduledAt,
        timeZone: input.policy.timeZone,
        originalRule: { offset: trigger.offsetIso, localTime: trigger.localTime },
        itemVersion: input.itemVersion,
        policyVersion: input.policy.version,
        shard: gsi3.shard,
        shardFnVersion: generation.shardFnVersion,
        status: "SCHEDULED",
        version: 1,
        createdAt: now,
        updatedAt: now,
        GSI3PK: gsi3.GSI3PK,
        GSI3SK: gsi3.GSI3SK,
        // D-151: native DynamoDB TTL, independent of the parent item/policy's own deletion
        // state — see reminder-occurrence.ts's `purgeAfterTtl` field doc.
        purgeAfterTtl: computeOccurrencePurgeAfterTtl(schedule.scheduledAtUtc),
        ...dstPending,
      };

      const wasCreated = await this.store.putIfAbsent(occurrence);
      if (wasCreated) {
        created.push(occurrence);
      } else {
        skippedExisting += 1;
      }
    }

    return { created, skippedExisting };
  }

  /**
   * Reacts to ItemDueDateChanged (implementation-blueprint.md §8.3): cancels occurrences
   * materialized under a stale itemVersion (still SCHEDULED/CLAIMED), one conditional
   * update per occurrence - NOT a single unbounded transaction (§8.3: "nenhuma transação
   * tenta cancelar um número ilimitado de ocorrências de uma só vez"). Returns the count
   * cancelled; callers (the outbox consumer / M3's due-date-change worker) then call
   * materialize() per active policy to create the fresh occurrences.
   */
  async cancelStaleOccurrences(input: { tenantId: string; itemId: string; currentItemVersion: number }): Promise<number> {
    const occurrences = await this.store.queryByItem<ReminderOccurrence>(input.tenantId, input.itemId);
    let cancelled = 0;
    for (const occurrence of occurrences) {
      if (occurrence.itemVersion >= input.currentItemVersion) continue;
      if (occurrence.status !== "SCHEDULED" && occurrence.status !== "CLAIMED") continue;
      try {
        await this.store.transactWrite([
          {
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key: { PK: occurrence.PK, SK: occurrence.SK },
              tenantId: input.tenantId,
              expectedVersion: occurrence.version,
              // Full-audit round1 (Arquitetura, Data Model & Consistency) fix: both GSI3 and
              // GSI6 pointers are now removed on cancellation. Previously only GSI6 was
              // removed (occ.ts's builder is SET-only; REMOVE support was added in M3.5 for
              // GSI6 but never extended to GSI3) - the scheduler index kept a stale pointer.
              // It was a harmless no-op in practice (the producer's SCHEDULED->CLAIMED
              // condition simply fails for a CANCELLED row), but it left a real, unbounded
              // data-consistency residue in the single-table's most sensitive index (GSI3 is
              // the one index with a deliberate cross-tenant-shaped key, per data-model.md
              // §3's isolation safeguard) with no cleanup mechanism ever proposed. Removing it
              // here keeps GSI3 containing only live SCHEDULED/CLAIMED work, matching the
              // invariant already enforced for GSI6.
              set: { status: "CANCELLED" },
              remove: ["GSI3PK", "GSI3SK", "GSI6PK", "GSI6SK"],
            }),
          },
        ]);
        cancelled += 1;
      } catch (err) {
        if (isTransactionCanceled(err)) continue; // lost a race (already advanced) - fine, not our job to cancel it
        throw err;
      }
    }
    return cancelled;
  }

  /**
   * Shared implementation for the two policy-fenced reconcile methods below
   * (reminder-delivery-pipeline.md §6/§4's unified policy-changed loop). Cancels
   * SCHEDULED/CLAIMED occurrences belonging to `policy.policyId` under `itemId` that match
   * `shouldCancel`, each in its own TransactWriteItems ALSO containing a ConditionCheck on
   * the policy row asserting it is still at `policy.version` (Codex Round F/G finding -
   * `buildVersionConditionCheck`, the same mechanism as the dispatch fence, commit
   * `3eeda33`). If the policy has moved on by commit time, that specific cancellation is
   * safely skipped rather than wrongly applied - the event that moved the policy again
   * always fires its own reconcile, which sees fresh state.
   */
  private async cancelOccurrencesFencedByPolicy(input: {
    tenantId: string;
    itemId: string;
    policy: ReminderPolicy;
    shouldCancel: (occurrence: ReminderOccurrence) => boolean;
  }): Promise<number> {
    const occurrences = await this.store.queryByItem<ReminderOccurrence>(input.tenantId, input.itemId);
    let cancelled = 0;
    for (const occurrence of occurrences) {
      if (occurrence.policyId !== input.policy.policyId) continue;
      if (occurrence.status !== "SCHEDULED" && occurrence.status !== "CLAIMED") continue;
      if (!input.shouldCancel(occurrence)) continue;
      try {
        await this.store.transactWrite([
          {
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key: { PK: occurrence.PK, SK: occurrence.SK },
              tenantId: input.tenantId,
              expectedVersion: occurrence.version,
              set: { status: "CANCELLED" },
              remove: ["GSI3PK", "GSI3SK", "GSI6PK", "GSI6SK"],
            }),
          },
          buildVersionConditionCheck({
            tableName: this.tableName,
            key: policyKey(input.tenantId, input.policy.policyId),
            expectedVersion: input.policy.version,
          }),
        ]);
        cancelled += 1;
      } catch (err) {
        // Codex implementation-review finding (real defect, same class D/E/F already fixed
        // in dispatch.ts): TransactionCanceledException is not synonymous with "the occurrence
        // advanced or the policy moved on" - throttling/an unrelated cancellation reason must
        // be retried, not silently treated as an already-resolved race. Only entry 0 (the
        // occurrence's own condition) or entry 1 (the policy fence) failing with
        // ConditionalCheckFailed is provably one of the two expected/safe races; anything else
        // rethrows so the caller (the trigger worker's SQS handler) reports a batch item
        // failure and SQS retries.
        const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
        const occurrenceOrFenceFailed = reasons?.[0]?.Code === "ConditionalCheckFailed" || reasons?.[1]?.Code === "ConditionalCheckFailed";
        if (isTransactionCanceled(err) && occurrenceOrFenceFailed) continue;
        throw err;
      }
    }
    return cancelled;
  }

  /**
   * For `itemId` as `policy`'s CURRENT target (reminder-delivery-pipeline.md §6): cancels
   * occurrences that are stale relative to the policy's current version, or whose policy is
   * now disabled. Leaves occurrences already at the current version/enabled state alone.
   */
  async reconcilePolicyOccurrences(input: { tenantId: string; itemId: string; policy: ReminderPolicy }): Promise<number> {
    return this.cancelOccurrencesFencedByPolicy({
      ...input,
      shouldCancel: (occurrence) => occurrence.policyVersion !== input.policy.version || !input.policy.enabled,
    });
  }

  /**
   * For `itemId` as a partition `policy` no longer targets (reminder-delivery-pipeline.md
   * §4/§5's unified policy-changed loop, `previousItemId` side): cancels EVERY live
   * occurrence for this policy under this item, regardless of version - there is no
   * "current version" to compare against, since the policy doesn't target this item at all
   * anymore. Never materializes here.
   */
  async reconcilePolicyOccurrencesUnconditionally(input: { tenantId: string; itemId: string; policy: ReminderPolicy }): Promise<number> {
    return this.cancelOccurrencesFencedByPolicy({ ...input, shouldCancel: () => true });
  }

  /**
   * For a terminal item transition (archive/delete/renewal-old-side,
   * reminder-delivery-pipeline.md §4/§8's `item-deactivated` event): cancels every live
   * occurrence under the item regardless of which policy owns it - no policy fence, since
   * this isn't gated on any one policy's state, only on the item itself being terminal
   * (already committed by the caller's own transaction before this event fires).
   */
  async cancelAllOccurrences(input: { tenantId: string; itemId: string }): Promise<number> {
    const occurrences = await this.store.queryByItem<ReminderOccurrence>(input.tenantId, input.itemId);
    let cancelled = 0;
    for (const occurrence of occurrences) {
      if (occurrence.status !== "SCHEDULED" && occurrence.status !== "CLAIMED") continue;
      try {
        await this.store.transactWrite([
          {
            Update: buildVersionedUpdate({
              tableName: this.tableName,
              key: { PK: occurrence.PK, SK: occurrence.SK },
              tenantId: input.tenantId,
              expectedVersion: occurrence.version,
              set: { status: "CANCELLED" },
              remove: ["GSI3PK", "GSI3SK", "GSI6PK", "GSI6SK"],
            }),
          },
        ]);
        cancelled += 1;
      } catch (err) {
        // Same fix as cancelOccurrencesFencedByPolicy above - only the occurrence's own
        // (sole) condition failing is provably safe to swallow.
        const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
        if (isTransactionCanceled(err) && reasons?.[0]?.Code === "ConditionalCheckFailed") continue;
        throw err;
      }
    }
    return cancelled;
  }
}
