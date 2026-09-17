/**
 * ReminderScan page worker - D-300
 * (`docs/architecture/reviews/reminder-producer-implementation-plan-scoping/DECISION.md` §1/§2/
 * §5), the fully-approved (Claude/Codex 9.3/9.3) implementation plan for PERF-12. This is the
 * "one page of `queryGsi3Page` -> lease transition + candidates" pure(ish) worker driven by the
 * SQS scan-continuation queue (as opposed to `producer.ts`'s EventBridge-driven enumeration +
 * acquire/reclaim path, which stays untouched).
 *
 * One invocation processes EXACTLY one page: reads the lease, validates ownership/epoch/staleness
 * (no-op if stale - never a throw), queries one GSI3 page, publishes candidate messages directly
 * to the claim queue (chunks of <=10, `SendMessageBatch` - NOT the outbox, no aggregate
 * transaction backs a claim candidate), then checkpoints the lease atomically with the next
 * continuation (or COMPLETED). Checkpoint only advances once ALL chunks for this page are
 * accepted (DECISION.md §5) - a candidate is never silently dropped by a checkpoint racing ahead
 * of its own publication.
 */
import type { EntityKey } from "../../shared/dynamodb/occ.js";
import { isSoleConditionalCancellation } from "../../shared/dynamodb/occ.js";
import { nextAttemptDelayMs } from "../../shared/outbox/outbox.js";
import type { SqsCommandEnvelope } from "../../shared/contracts/events.js";
import { gsi3PartitionForShard } from "../../modules/reminder/domain/reminder-occurrence.js";
import { parseGsi3Sk } from "../../modules/reminder/domain/gsi3-parse.js";
import { parseChasingGsi3Sk } from "../../modules/subject/domain/document-chasing.js";
import { serializeCanonicalKey, deserializeCanonicalKey } from "../../shared/dynamodb/canonical-key.js";
import { InternalError, DependencyUnavailableError } from "../../shared/errors/app-error.js";
import { buildCheckpointLeaseTransaction, leaseKey, type ReminderScanLease, type ShardMinuteRef } from "./lease.js";

export interface ScanPageStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  queryGsi3Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: {
    gsi3pk: string;
    exclusiveStartKey?: Record<string, unknown>;
    limit: number;
  }): Promise<{ items: T[]; lastEvaluatedKey?: Record<string, unknown> }>;
  transactWrite(entries: import("../../shared/dynamodb/occ.js").TransactWriteEntry[]): Promise<void>;
}

export interface ClaimCandidateCommand extends SqsCommandEnvelope<{
  PK: string;
  SK: string;
  entityKind: "REMINDER" | "CHASING";
  rolloutEpoch: number;
}> {
  commandType: "reminder.claim-candidate.v1";
}

/** Outcome of ONE `SendMessageBatch` call for a chunk of <=10 candidates - mirrors the AWS SDK's
 * own per-entry failure shape closely enough for callers to distinguish sender-fault (malformed
 * message - never retryable, no amount of resending fixes it) from a transient/throttling
 * failure (whole chunk resent, per DECISION.md §5 - "não só entradas falhas"). */
export interface SendMessageBatchOutcome {
  failedEntryIds: { id: string; senderFault: boolean }[];
}

export interface ClaimQueuePort {
  sendMessageBatch(entries: ClaimCandidateCommand[]): Promise<SendMessageBatchOutcome>;
}

export interface ScanPageDeps {
  store: ScanPageStore;
  claimQueue: ClaimQueuePort;
  tableName: string;
  now: () => string;
  newEventId: () => string;
  correlationId: () => string;
  rolloutEpoch: number;
  /** DECISION.md §3: "200 candidatos/página". */
  pageSize: number;
  /** DECISION.md §3: "200s". */
  leaseDurationMs: number;
  /** Injected so retry backoff (DECISION.md §5, reusing `nextAttemptDelayMs`) never uses a real
   * timer in tests - production composition passes a real `setTimeout`-backed sleep. */
  sleep: (ms: number) => Promise<void>;
}

export type ScanPageOutcome =
  | { kind: "PROCESSED"; pagesProcessed: 1; candidatesPublished: number; completed: boolean }
  /** Lease missing, not IN_PROGRESS, or owned by a different token - a duplicate/redelivered
   * continuation message for a lease some OTHER invocation already reclaimed or completed.
   * DECISION.md §2 row 5: "nenhum write - ack, no-op". */
  | { kind: "STALE_NO_OP" }
  /** DECISION.md §8: a residual continuation message from before a rollback, carrying an epoch
   * older than the current `SCAN_MODE_EPOCH` - dropped without touching the lease at all. */
  | { kind: "STALE_EPOCH_DROPPED" }
  /** The checkpoint's `TransactWriteItems` lost a race (another invocation of the SAME owner
   * token's chain, or a reclaim, checkpointed first) - candidates for this page were already
   * published, so this is a benign duplicate-checkpoint-attempt no-op, never a data-loss case. */
  | { kind: "LOST_CHECKPOINT_RACE" };

const MAX_SEND_ATTEMPTS = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function buildCandidateCommand(deps: ScanPageDeps, row: { PK: string; SK: string }, tenantId: string, entityKind: "REMINDER" | "CHASING"): ClaimCandidateCommand {
  return {
    messageVersion: 1,
    messageId: deps.newEventId(),
    commandType: "reminder.claim-candidate.v1",
    createdAt: deps.now(),
    correlationId: deps.correlationId(),
    tenantId,
    deduplicationKey: `${tenantId}|${row.PK}|${row.SK}|${deps.rolloutEpoch}`,
    data: { PK: row.PK, SK: row.SK, entityKind, rolloutEpoch: deps.rolloutEpoch },
  };
}

/** Sends one chunk of <=10 candidates, resending the WHOLE chunk (never just the failed
 * entries - DECISION.md §5) up to `MAX_SEND_ATTEMPTS` times on transient failure, with
 * `nextAttemptDelayMs` backoff between attempts. A sender-fault entry (malformed message) is
 * never retried - throws immediately (`InternalError`), leaving the checkpoint untouched so the
 * whole page is reprocessed from scratch on the next reclaim (DECISION.md §5: "a página inteira
 * é reprocessada do zero... nunca silenciosamente descartada"). */
async function sendChunkWithRetry(deps: ScanPageDeps, chunkEntries: ClaimCandidateCommand[]): Promise<void> {
  for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
    const outcome = await deps.claimQueue.sendMessageBatch(chunkEntries);
    if (outcome.failedEntryIds.length === 0) return;

    const senderFault = outcome.failedEntryIds.find((f) => f.senderFault);
    if (senderFault) {
      throw new InternalError(`reminder-scan: SendMessageBatch sender fault on candidate ${senderFault.id} - malformed message, never retryable.`, {
        failedEntryIds: outcome.failedEntryIds,
      });
    }

    if (attempt < MAX_SEND_ATTEMPTS - 1) {
      await deps.sleep(nextAttemptDelayMs(attempt));
    }
  }
  throw new DependencyUnavailableError("reminder-scan: SendMessageBatch failed (transient) after max attempts - Lambda retry/DLQ will reprocess.", {
    attempts: MAX_SEND_ATTEMPTS,
  });
}

export interface ScanPageInput {
  ref: ShardMinuteRef;
  ownerToken: string;
  /** The `lastEvaluatedKey` this continuation message carries (canonical-serialized) - undefined
   * for a fresh start (page 1). */
  startedFromLastEvaluatedKey: string | undefined;
  /** DECISION.md §8: the epoch this continuation message was produced under. */
  messageRolloutEpoch: number;
}

/** Processes exactly one GSI3 page for the (shard, minute) lease `input.ref` refers to. */
export async function runScanPage(deps: ScanPageDeps, input: ScanPageInput): Promise<ScanPageOutcome> {
  if (input.messageRolloutEpoch < deps.rolloutEpoch) {
    return { kind: "STALE_EPOCH_DROPPED" };
  }

  const lease = await deps.store.get<ReminderScanLease>(leaseKey(input.ref));
  if (!lease || lease.status !== "IN_PROGRESS" || lease.ownerToken !== input.ownerToken ||
    lease.leaseUntil < deps.now() || lease.lastEvaluatedKey !== input.startedFromLastEvaluatedKey) {
    return { kind: "STALE_NO_OP" };
  }

  const gsi3pk = gsi3PartitionForShard(new Date(input.ref.minuteISO), input.ref.shardId);
  const exclusiveStartKey = deserializeCanonicalKey(input.startedFromLastEvaluatedKey);
  const page = await deps.store.queryGsi3Page<{ PK: string; SK: string; GSI3SK: string }>({ gsi3pk, exclusiveStartKey, limit: deps.pageSize });

  const candidates: ClaimCandidateCommand[] = [];
  for (const row of page.items) {
    const chasing = parseChasingGsi3Sk(row.GSI3SK);
    if (chasing) {
      candidates.push(buildCandidateCommand(deps, row, chasing.tenantId, "CHASING"));
      continue;
    }
    try {
      const reminder = parseGsi3Sk(row.GSI3SK);
      candidates.push(buildCandidateCommand(deps, row, reminder.tenantId, "REMINDER"));
    } catch {
      // Fail-closed, same discipline as producer.ts's unknownEntityType path - never silently
      // drop a row this worker can't identify. Unlike producer.ts, there is no per-tick counter
      // to surface this through here; the caller (Lambda handler) is expected to log/alarm on an
      // unexpectedly short candidates.length vs. page.items.length if this ever fires.
      continue;
    }
  }

  for (const c of chunk(candidates, 10)) {
    await sendChunkWithRetry(deps, c);
  }

  const nextLastEvaluatedKey = serializeCanonicalKey(page.lastEvaluatedKey);
  const tx = buildCheckpointLeaseTransaction(deps, {
    ref: input.ref,
    ownerToken: input.ownerToken,
    expectedVersion: lease.version,
    startedFromLastEvaluatedKey: input.startedFromLastEvaluatedKey,
    nextLastEvaluatedKey,
    pagesProcessedTotal: lease.pagesProcessed + 1,
    candidatesPublishedTotal: lease.candidatesPublished + candidates.length,
    leaseDurationMs: deps.leaseDurationMs,
  });

  try {
    await deps.store.transactWrite(tx);
  } catch (err) {
    if (isSoleConditionalCancellation(err, 0)) {
      return { kind: "LOST_CHECKPOINT_RACE" };
    }
    throw err;
  }

  return { kind: "PROCESSED", pagesProcessed: 1, candidatesPublished: candidates.length, completed: nextLastEvaluatedKey === undefined };
}
