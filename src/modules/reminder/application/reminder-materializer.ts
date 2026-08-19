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
import { gsi3Keys, occurrenceKey, stableHash, type ReminderOccurrence } from "../domain/reminder-occurrence.js";
import type { ReminderPolicy, QuietHours } from "../domain/reminder-policy.js";
import type { ShardConfig } from "../domain/shard-config.js";
import { activeGenerations } from "../domain/shard-config.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
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
              // GSI3PK/GSI3SK are intentionally left in place (occ.ts's builder is
              // SET-only, no REMOVE) - the scheduler index keeps a stale pointer, but the
              // producer's own SCHEDULED->CLAIMED condition (§9.3) will simply fail for a
              // CANCELLED row, so it is skipped as a harmless no-op claim attempt, not a
              // false trigger. Documented judgment call, see report. GSI6PK/GSI6SK (M3.5),
              // unlike GSI3, ARE actively queried by reconciliation, so a stale
              // WORKSTATE#DST_PENDING pointer on a CANCELLED occurrence would be a real bug
              // (reconciliation would keep re-evaluating dead work) - removed here.
              set: { status: "CANCELLED" },
              remove: ["GSI6PK", "GSI6SK"],
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
}
