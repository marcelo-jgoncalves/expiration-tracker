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
import { buildVersionedUpdate } from "../../shared/dynamodb/occ.js";
import { gsi3PartitionsForMinute } from "../../modules/reminder/domain/reminder-occurrence.js";
import { parseGsi3Sk } from "../../modules/reminder/domain/gsi3-parse.js";
import { activeGenerations, type ShardConfig } from "../../modules/reminder/domain/shard-config.js";
import { isTransactionCanceled } from "../../modules/reminder/ports/reminder-store.js";
import type { ReminderProducerStore } from "../../modules/reminder/ports/reminder-store.js";
import type { ReminderOccurrence } from "../../modules/reminder/domain/reminder-occurrence.js";
import { appendToTransaction, type DynamoTransactPutEntry } from "../../shared/outbox/outbox.js";
import { GSI6PK_WORKSTATE_CLAIMED, buildExpiredClaimGsi6Sk } from "../../modules/reminder/ports/reconciliation-candidate-source.js";
import type { DomainEvent } from "../../shared/contracts/events.js";
import { parseChasingGsi3Sk } from "../../modules/subject/domain/document-chasing.js";
import { claimChasingOccurrence, type ChasingDispatchCommand } from "../../modules/subject/application/document-chasing-producer.js";

export interface DispatchCommand {
  /**
   * Real fix for a pre-existing bug found during M5's observability review (registered in
   * NEXT_SESSION_PROMPT.md): `schemas/queues/reminder-dispatch.v1.json` extends
   * `command-envelope.v1.json` via `allOf`, which already required `messageVersion`/
   * `messageId`/`createdAt`/`correlationId` at the top level - but this command never
   * carried them, so `reminder-dispatch-handler.ts`'s own schema validation against the
   * real SQS body would always reject it as schema-invalid. This is a bug fix making the
   * implementation match its own already-approved v1 contract, not a new schema version.
   */
  messageVersion: 1;
  messageId: string;
  createdAt: string;
  correlationId: string;
  commandType: "reminder.dispatch.v1";
  tenantId: string;
  deduplicationKey: string;
  data: {
    itemId: string;
    occurrenceId: string;
    occurrenceVersion: number;
    scheduledAt: string;
    itemVersion: number;
    policyVersion: number;
  };
}

export interface ProducerDeps {
  store: ReminderProducerStore;
  shardConfig: ShardConfig;
  tableName: string;
  now: () => string;
  /** Short claim TTL - default 2 minutes, comfortably longer than one producer tick (1 minute) but short enough that a crashed dispatch worker's claim is reclaimable quickly by reconciliation (§9.5). */
  claimTtlMs?: number;
  /** Lookback window in minutes, inclusive of the current minute (implementation-blueprint.md §9.3 example: [M-5min, M]). */
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
  const lookback = deps.lookbackMinutes ?? 5;
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
        for (const row of rows) {
          scanned += 1;

          // M10 cluster 4: try the chasing shape FIRST (never throws, `undefined` on no
          // match) - the reminder branch below is completely unchanged otherwise.
          const chasingParsed = parseChasingGsi3Sk(row.GSI3SK);
          if (chasingParsed) {
            if (seen.has(chasingParsed.occurrenceId)) continue;
            seen.add(chasingParsed.occurrenceId);
            try {
              const outcome = await claimChasingOccurrence(
                { store: deps.store, tableName: deps.tableName, now: deps.now, claimTtlMs, newEventId: deps.newEventId, correlationId: deps.correlationId },
                { PK: row.PK, SK: row.SK },
              );
              if (outcome.kind === "CLAIMED") chasingClaimed.push(outcome.command);
              // SKIPPED_NOT_SCHEDULED / LOST_CLAIM_RACE: not failures, same as the reminder path below.
            } catch (err) {
              failed.push({ occurrenceId: chasingParsed.occurrenceId, tenantId: chasingParsed.tenantId, error: err });
            }
            continue;
          }

          let reminderParsed: { tenantId: string; occurrenceId: string };
          try {
            reminderParsed = parseGsi3Sk(row.GSI3SK);
          } catch {
            // Fail-closed (D-039): neither pattern matched - never process a row we can't
            // identify, never skip it silently either. Alarm-worthy, surfaced via the tick result.
            unknownEntityType += 1;
            continue;
          }
          const { tenantId, occurrenceId } = reminderParsed;
          if (seen.has(occurrenceId)) continue;
          seen.add(occurrenceId);

          try {
            const occurrence = await deps.store.get<ReminderOccurrence>({ PK: row.PK, SK: row.SK });
            if (!occurrence || occurrence.status !== "SCHEDULED") {
              // Already claimed/cancelled/triggered by a prior tick or race - not a failure.
              continue;
            }

            const claimExpiresAt = new Date(Date.parse(deps.now()) + claimTtlMs).toISOString();
            const newVersion = occurrence.version + 1;
            const now = deps.now();
            // Same value used for both the command's own envelope correlationId (read
            // directly from the SQS body per m5-observability-design.md #2's general SQS
            // rule) and the outbox DomainEvent's correlationId - one business correlation
            // per dispatch, not two independently-generated ids for the same operation.
            const correlationId = deps.correlationId();

            const command: DispatchCommand = {
              messageVersion: 1,
              messageId: deps.newEventId(),
              createdAt: now,
              correlationId,
              commandType: "reminder.dispatch.v1",
              tenantId,
              deduplicationKey: `${tenantId}|${occurrenceId}|${newVersion}`,
              data: {
                itemId: occurrence.itemId,
                occurrenceId,
                occurrenceVersion: newVersion,
                scheduledAt: occurrence.scheduledAt,
                itemVersion: occurrence.itemVersion,
                policyVersion: occurrence.policyVersion,
              },
            };

            // M3.5 "Decisão central: outbox durável": TransactWrite(claim) followed by a
            // direct SendMessage in the handler is NOT atomic (Lambda can die between the
            // two steps, leaving a CLAIMED occurrence with no queued command - neither the
            // producer's own lookback window nor the daily DST reconciliation reliably
            // covers that gap). The fix: write a durable OutboxEvent
            // (destination=SQS_REMINDER_DISPATCH_V1) in the SAME transaction as the claim;
            // DispatchOutboxRelay (DynamoDB Streams) publishes it to SQS, a sweeper recovers
            // publication failures. Also set the GSI6 WORKSTATE#CLAIMED pointer so the
            // reconciliation job can find this claim if it expires unrecovered - removed
            // when ReminderDispatch advances to TRIGGERED or reconciliation reverts it.
            const event: DomainEvent = {
              specVersion: "1.0",
              eventId: deps.newEventId(),
              eventType: "ReminderDispatchRequested",
              source: "expiration-tracker.reminder-producer",
              occurredAt: now,
              correlationId,
              tenantId,
              actor: { type: "SYSTEM" },
              aggregate: { type: "ReminderOccurrence", id: occurrenceId, version: newVersion },
              data: command as unknown as Record<string, unknown>,
            };
            const outboxEntries: DynamoTransactPutEntry[] = [];
            appendToTransaction(outboxEntries, deps.tableName, event, "SQS_REMINDER_DISPATCH_V1");

            await deps.store.transactWrite([
              {
                Update: buildVersionedUpdate({
                  tableName: deps.tableName,
                  key: { PK: row.PK, SK: row.SK },
                  tenantId,
                  expectedVersion: occurrence.version,
                  set: {
                    status: "CLAIMED",
                    claimedAt: deps.now(),
                    claimExpiresAt,
                    GSI6PK: GSI6PK_WORKSTATE_CLAIMED,
                    GSI6SK: buildExpiredClaimGsi6Sk(claimExpiresAt, tenantId, occurrenceId),
                  },
                }),
              },
              ...outboxEntries,
            ]);

            claimed.push(command);
          } catch (err) {
            if (isTransactionCanceled(err)) {
              // Lost the claim race to a concurrent producer tick - not a failure to retry.
              continue;
            }
            failed.push({ occurrenceId, tenantId, error: err });
          }
        }
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
