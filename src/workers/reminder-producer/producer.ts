/**
 * ReminderProducer core logic - implementation-blueprint.md §9.3. Pure(ish) - takes an
 * injected `ReminderProducerStore` and clock, no AWS SDK/Lambda runtime dependency, so it
 * is directly unit/integration-testable with a fake clock and fake GSI3 index (per the
 * task's requirement to test time-sensitive logic without real wall-clock waiting).
 *
 * Steps (§9.3):
 *  1. read active shard generations (current + still-active legacy, §9.2's reshard runbook);
 *  2. query GSI3 across N shards of minute M AND a lookback window [M-lookback, M] (default
 *     5 minutes) - "sem lookback, 'o próximo tick reprocessa' é falso";
 *  3. per eligible occurrence, conditional SCHEDULED -> CLAIMED with a short claim
 *     `claimExpiresAt`, and emit one `reminder.dispatch.v1` command;
 *  4. partial-batch-failure handling: only failed entries are surfaced in `failed`, callers
 *     retry just those (never the whole batch);
 *  5. returns counters for `scheduler_lag_seconds`/per-shard/lookback-depth metrics (left to
 *     the Lambda handler to emit via SecureLogger/EMF - this module stays observability-agnostic).
 *
 * M10 cluster 4 (D-039/D-046/D-048): GSI3 is now a SHARED scheduler for two entity types,
 * discriminated by the SHAPE of the GSI3SK read back from the index (`...#OCCURRENCE#...` for
 * `ReminderOccurrence`, unchanged; `...#CHASING#...` for `DocumentChasingOccurrence`, new) - a
 * single `queryGsi3` call for a given shard/minute can return BOTH types mixed together, since
 * they share the same physical partition space. The reminder branch below is byte-for-byte
 * identical to before this change (same transaction shape, same command, same event) - only the
 * dispatch/routing at the top of the loop is new. An unrecognized GSI3SK shape (neither pattern
 * matches) is fail-closed: counted in `unknownEntityType` (a SEPARATE counter from `failed` -
 * an unrecognized row never has a real occurrenceId/tenantId to put there) - the Lambda handler
 * (reminder-producer-handler.ts) throws whenever it's nonzero, via `shouldAlarm()` below, so a
 * real CloudWatch alarm fires - never processed or silently skipped by omission.
 */
import { gsi3PartitionsForMinute } from "../../modules/reminder/domain/reminder-occurrence.js";
import { parseGsi3Sk } from "../../modules/reminder/domain/gsi3-parse.js";
import { activeGenerations, type ShardConfig } from "../../modules/reminder/domain/shard-config.js";
import type { ReminderProducerStore } from "../../modules/reminder/ports/reminder-store.js";
import { parseChasingGsi3Sk } from "../../modules/subject/domain/document-chasing.js";
import { claimChasingOccurrence, type ChasingDispatchCommand } from "../../modules/subject/application/document-chasing-producer.js";
import { claimReminderOccurrence, type ReminderDispatchCommand } from "../../modules/reminder/application/reminder-claim.js";
import { mapWithConcurrency } from "../../shared/concurrency/map-with-concurrency.js";

/**
 * D-300 (`reminder-producer-implementation-plan-scoping/DECISION.md` §1): re-exported alias of
 * `ReminderDispatchCommand` (`modules/reminder/application/reminder-claim.ts`) - this file's own
 * inline claim block was extracted there (`claimReminderOccurrence`) so it can be shared with the
 * new claim-consumer Lambda. Kept as `DispatchCommand` here for backward compatibility with every
 * existing import site in this codebase (~unchanged public name, same shape).
 */
export type DispatchCommand = ReminderDispatchCommand;

export interface ProducerDeps {
  store: ReminderProducerStore;
  shardConfig: ShardConfig;
  tableName: string;
  dueWorkTableName?: string;
  now: () => string;
  /** Short claim TTL - default 2 minutes, comfortably longer than one producer tick (1 minute) but short enough that a crashed dispatch worker's claim is reclaimable quickly by reconciliation (§9.5). */
  claimTtlMs?: number;
  /**
   * Lookback window in minutes, inclusive of the current minute (implementation-blueprint.md
   * §9.3 example: [M-5min, M]). Default raised from 5 to 15 (PERF-12 1k load test,
   * docs/engineering/performance/results/PERF-12-async-pipeline-1k.md): under a realistic
   * burst (many occurrences due the same minute) the producer's 10s timeout could be
   * exceeded for several consecutive minutes, and any occurrence still SCHEDULED once its
   * minute aged out of a 5-minute lookback was never reconciled by any other pass (see
   * reconciliation.ts's own file header - CLAIMS reconciliation only reverts already-CLAIMED
   * occurrences, DST reconciliation only re-materializes missing ones; neither covers
   * "SCHEDULED, past lookback, never claimed"). 15 minutes gives roughly 2x margin over the
   * observed 7-minute burst-recovery window, at a bounded extra cost (shardCount ×
   * lookbackMinutes extra GSI3 partition queries per NORMAL tick, most of them empty) - a
   * dedicated reconciliation pass for this case was considered but rejected: GSI3 query
   * access is deliberately isolated to ONLY this worker (reminder-store.ts's own doc comment,
   * enforced by test/integration/gsi3-isolation.test.ts and infra/main.tf's "the ONLY
   * function granted gsi3_read" policy comment) - widening the SAME worker's own lookback,
   * combined with the timeout raise and the parallelism below (both fix the actual cause,
   * this is the safety net), stays inside that existing boundary instead of punching a new
   * hole in it.
   */
  lookbackMinutes?: number;
  /** Deterministic-in-tests ID generator for the durable outbox event written in the same
   * transaction as the claim (M3.5 "Decisão central: outbox durável" - see runProducerTick). */
  newEventId: () => string;
  correlationId: () => string;
}

export interface ProducerTickResult {
  claimed: DispatchCommand[];
  /** M10 cluster 4: DocumentChasingOccurrence claims from the SAME GSI3 scan, kept in a
   * separate array (different command shape) - never merged into `claimed`. */
  chasingClaimed: ChasingDispatchCommand[];
  failed: { occurrenceId: string; tenantId: string; error: unknown }[];
  /** GSI3SK shape matched neither the reminder nor the chasing pattern - fail-closed, never
   * processed. Should always be 0 in practice; a nonzero count is alarm-worthy (D-039). */
  unknownEntityType: number;
  scanned: number;
  minutesScanned: string[];
  shardPartitionsScanned: number;
}

function minuteFloor(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

/**
 * PERF-12 1k load test finding (docs/engineering/performance/results/PERF-12-async-pipeline-1k.md):
 * this loop used to process one occurrence at a time - one `store.get` + one
 * `store.transactWrite` per occurrence, fully sequential - inside a Lambda with (at the time)
 * a 10s timeout. With ~250 occurrences concentrated in one shard/minute under a realistic
 * burst, that budget was nowhere near enough, the function was killed mid-loop repeatedly, and
 * occurrences that hadn't been claimed yet eventually aged out of the lookback window,
 * permanently stuck in SCHEDULED. Bounded concurrency here mirrors the exact pattern already
 * used for the same reason in reminder-dispatch-handler.ts (D-170) - each occurrence's own
 * `transactWrite` stays a single, independent atomic conditional claim (never merged across
 * occurrences), so parallelizing here does not touch the transactional or idempotency
 * guarantees of any individual claim, only how many claims run concurrently. A plain numeric
 * constant, not unbounded `Promise.all`, to keep the burst of concurrent DynamoDB round trips
 * per invocation predictable.
 */
const PRODUCER_CLAIM_CONCURRENCY = 8;

/**
 * Pure alarm decision, extracted so the Lambda handler's "when should this tick throw" logic
 * is unit-testable without mocking the whole handler/composition root (achado real de revisão
 * adversarial, D-039/D-046/D-048: an earlier version of this fail-closed path was silently
 * absorbed by the handler - `unknownEntityType` was counted but nothing ever read it). Two
 * independent reasons, checked in this order for a stable, deterministic message:
 * unrecognized GSI3SK shape (fail-closed, never a retry-race) first, then genuine per-occurrence
 * claim failures.
 */
export function shouldAlarm(result: ProducerTickResult): { alarm: boolean; reason?: string } {
  if (result.unknownEntityType > 0) {
    return { alarm: true, reason: `reminder-producer: ${result.unknownEntityType} GSI3 row(s) matched neither the reminder nor the chasing entityType - fail-closed` };
  }
  if (result.failed.length > 0) {
    return { alarm: true, reason: `reminder-producer: ${result.failed.length} occurrence(s) failed to claim` };
  }
  return { alarm: false };
}

/** Runs one producer tick for wall-clock minute `tickMinute` (already floored to the minute by the caller/Lambda trigger). */
export async function runProducerTick(deps: ProducerDeps, tickMinute: Date): Promise<ProducerTickResult> {
  const generations = activeGenerations(deps.shardConfig, deps.now());
  const lookback = deps.lookbackMinutes ?? 15;
  const claimTtlMs = deps.claimTtlMs ?? 2 * 60_000;

  const minutesToScan: Date[] = [];
  for (let i = lookback; i >= 0; i--) {
    minutesToScan.push(minuteFloor(new Date(tickMinute.getTime() - i * 60_000)));
  }

  const claimed: DispatchCommand[] = [];
  const chasingClaimed: ChasingDispatchCommand[] = [];
  const failed: { occurrenceId: string; tenantId: string; error: unknown }[] = [];
  let unknownEntityType = 0;
  let scanned = 0;
  let partitions = 0;

  // Dedup guard: the same occurrence could show up in more than one scanned minute only if
  // materialization ever wrote it under a stale bucket, which shouldn't happen - but a
  // Set guards against double-claiming within a single tick regardless.
  const seen = new Set<string>();

  for (const minute of minutesToScan) {
    for (const generation of generations) {
      const partitionKeys = gsi3PartitionsForMinute(minute, generation.shardCount);
      partitions += partitionKeys.length;
      for (const gsi3pk of partitionKeys) {
        const rows = await deps.store.queryGsi3<{ PK: string; SK: string; GSI3SK: string }>({ gsi3pk });
        // PERF-12: this used to be `for (const row of rows)`, one `get`+`transactWrite` pair
        // processed strictly sequentially - see PRODUCER_CLAIM_CONCURRENCY's doc comment for
        // why bounded concurrency replaces that here. `seen`/`claimed`/`failed`/
        // `chasingClaimed`/counters are shared mutable state across concurrent callbacks, but
        // every access happens either synchronously (no `await` in between, so the JS event
        // loop cannot interleave two callbacks' synchronous sections) or as an atomic
        // push/increment - never a race in practice under Node's single-threaded model.
        await mapWithConcurrency(rows, PRODUCER_CLAIM_CONCURRENCY, async (row) => {
          scanned += 1;

          // M10 cluster 4: try the chasing shape FIRST (never throws, `undefined` on no
          // match) - the reminder branch below is completely unchanged otherwise.
          const chasingParsed = parseChasingGsi3Sk(row.GSI3SK);
          if (chasingParsed) {
            if (seen.has(chasingParsed.occurrenceId)) return;
            seen.add(chasingParsed.occurrenceId);
            try {
              const outcome = await claimChasingOccurrence(
                { store: deps.store, tableName: deps.tableName, dueWorkTableName: deps.dueWorkTableName, now: deps.now, claimTtlMs, newEventId: deps.newEventId, correlationId: deps.correlationId },
                { PK: row.PK, SK: row.SK },
              );
              if (outcome.kind === "CLAIMED") chasingClaimed.push(outcome.command);
              // SKIPPED_NOT_SCHEDULED / LOST_CLAIM_RACE: not failures, same as the reminder path below.
            } catch (err) {
              failed.push({ occurrenceId: chasingParsed.occurrenceId, tenantId: chasingParsed.tenantId, error: err });
            }
            return;
          }

          let reminderParsed: { tenantId: string; occurrenceId: string };
          try {
            reminderParsed = parseGsi3Sk(row.GSI3SK);
          } catch {
            // Fail-closed (D-039): neither pattern matched - never process a row we can't
            // identify, never skip it silently either. Alarm-worthy, surfaced via the tick result.
            unknownEntityType += 1;
            return;
          }
          const { tenantId, occurrenceId } = reminderParsed;
          if (seen.has(occurrenceId)) return;
          seen.add(occurrenceId);

          // D-300: this used to be an inline conditional-claim + outbox-durable-dispatch block;
          // extracted to claimReminderOccurrence (modules/reminder/application/reminder-claim.ts)
          // so the new claim-consumer Lambda can share the exact same transaction shape instead
          // of duplicating it. Byte-for-byte same behavior - same builder, same outbox
          // destination, same GSI6 pointer, same lost-race handling.
          try {
            const outcome = await claimReminderOccurrence(
              {
                store: deps.store, tableName: deps.tableName, dueWorkTableName: deps.dueWorkTableName,
                // D-303 (addendum): this is the LEGACY/rollback-only scan path (SCAN_MODE=LEGACY),
                // deliberately kept on the main table's own shared outbox/stream rather than the
                // dedicated D-303 table - an explicit choice made here at the one call site that
                // needs it, never an implicit default inside claimReminderOccurrence itself.
                dispatchOutboxTableName: deps.tableName,
                now: deps.now, claimTtlMs, newEventId: deps.newEventId, correlationId: deps.correlationId,
              },
              { PK: row.PK, SK: row.SK },
              tenantId,
            );
            if (outcome.kind === "CLAIMED") claimed.push(outcome.command);
            // SKIPPED_NOT_SCHEDULED / LOST_CLAIM_RACE: not failures, same as the chasing path above.
          } catch (err) {
            failed.push({ occurrenceId, tenantId, error: err });
          }
        });
      }
    }
  }

  return {
    claimed,
    chasingClaimed,
    failed,
    unknownEntityType,
    scanned,
    minutesScanned: minutesToScan.map((d) => d.toISOString()),
    shardPartitionsScanned: partitions,
  };
}
