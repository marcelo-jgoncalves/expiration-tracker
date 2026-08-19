/**
 * DispatchOutboxRelay + OutboxSweeperReminderDispatch core logic (M3.5,
 * docs/architecture/m3.5-runtime-design.md "Decisão central: outbox durável"). Pure(ish) -
 * injected store/queue/clock, no AWS SDK/Lambda runtime dependency, same pattern as
 * src/workers/reminder-producer/producer.ts.
 *
 * Both the relay (triggered per-record by DynamoDB Streams) and the sweeper (triggered on
 * a schedule, sourcing candidates via `listPendingReminderDispatch`) call the SAME
 * `publishOne` - the only difference is how they discover which records to attempt.
 */
import type { OutboxRecord, OutboxDestination } from "../../shared/outbox/outbox.js";
import type { OutboxRelayStore } from "../../shared/outbox/relay-store.js";

export const SQS_REMINDER_DISPATCH_V1: OutboxDestination = "SQS_REMINDER_DISPATCH_V1";

export interface RelayDeps {
  store: OutboxRelayStore;
  sendToDispatchQueue: (payload: Record<string, unknown>) => Promise<void>;
  now: () => string;
  leaseOwner: string;
  /** How long a lease is held while attempting SendMessage - default 30s, comfortably
   * longer than one SQS SendMessage call, short enough that a crashed relay invocation's
   * lease is quickly reclaimable by the next relay/sweeper attempt. */
  leaseDurationMs?: number;
}

export type PublishOutcome =
  | { kind: "PUBLISHED" }
  | { kind: "SKIPPED_WRONG_DESTINATION" }
  | { kind: "SKIPPED_ALREADY_PUBLISHED" }
  | { kind: "SKIPPED_LEASE_HELD" }
  | { kind: "FAILED"; error: unknown };

/** Attempts to publish exactly one outbox record. Never throws for expected outcomes
 * (wrong destination / already published / lease contention) - only for genuinely
 * unexpected failures during acquire/send/mark, surfaced as `FAILED` so the caller (relay
 * Lambda: partial batch failure; sweeper: per-item log+continue) decides retry policy. */
export async function publishOne(deps: RelayDeps, record: OutboxRecord): Promise<PublishOutcome> {
  // Exclusivity (docs/architecture/m3.5-runtime-design.md §"Decisão central"): this relay/
  // sweeper NEVER touches a record it doesn't own the destination for - OutboxPublisher
  // (generic, EventBridge) owns everything else, including records with no `destination`.
  if (record.destination !== SQS_REMINDER_DISPATCH_V1) {
    return { kind: "SKIPPED_WRONG_DESTINATION" };
  }
  if (record.status === "PUBLISHED") {
    return { kind: "SKIPPED_ALREADY_PUBLISHED" };
  }

  const leaseDurationMs = deps.leaseDurationMs ?? 30_000;
  const now = deps.now();
  const leaseExpiresAt = new Date(Date.parse(now) + leaseDurationMs).toISOString();

  const acquired = await deps.store.tryAcquireLease({ PK: record.PK, SK: record.SK }, deps.leaseOwner, leaseExpiresAt, now);
  if (!acquired) {
    return { kind: "SKIPPED_LEASE_HELD" };
  }

  try {
    await deps.sendToDispatchQueue(record.payload);
  } catch (error) {
    // Failure here is expected and recoverable: the lease expires, the sweeper (or a later
    // Stream retry) will retry. A duplicate SendMessage after a retry is absorbed by the
    // dispatch worker's own idempotency (M3, claim by deterministic occurrenceId) - never
    // treated as a reason to skip retrying.
    return { kind: "FAILED", error };
  }

  // Transition PENDING -> PUBLISHED only AFTER SendMessage confirmed (m3.5-runtime-design.md:
  // "falha entre (2) e (3) é aceitável - duplicata é absorvida pela idempotência do
  // dispatch"). Failure here also just means the sweeper resends a message that was
  // already delivered once - still recoverable, not a correctness issue.
  await deps.store.markPublished({ PK: record.PK, SK: record.SK });
  return { kind: "PUBLISHED" };
}

/** DispatchOutboxRelay entrypoint logic: one call per DynamoDB Streams record (NEW_IMAGE). */
export async function relayStreamRecord(deps: RelayDeps, record: OutboxRecord): Promise<PublishOutcome> {
  return publishOne(deps, record);
}

export interface SweeperDeps extends RelayDeps {
  /** Minimum age (ms) before a PENDING record is swept - covers relay/Stream failure, not
   * normal in-flight latency (m3.5-runtime-design.md: "occurredAt mais antigo que um
   * limiar (2 min)"). */
  minAgeMs?: number;
  pageSize?: number;
}

export interface SweepResult {
  attempted: number;
  published: number;
  failed: number;
  stillPending: number;
}

/** OutboxSweeperReminderDispatch entrypoint logic: no backoff of its own - every scheduled
 * execution IS one retry attempt (m3.5-runtime-design.md: "nenhum backoff próprio"). */
export async function sweepPendingDispatch(deps: SweeperDeps): Promise<SweepResult> {
  const minAgeMs = deps.minAgeMs ?? 2 * 60_000;
  const olderThan = new Date(Date.parse(deps.now()) - minAgeMs).toISOString();

  const candidates = await deps.store.listPendingReminderDispatch({
    destination: SQS_REMINDER_DISPATCH_V1,
    olderThan,
    pageSize: deps.pageSize,
  });

  let published = 0;
  let failed = 0;
  let stillPending = 0;

  for (const record of candidates) {
    const outcome = await publishOne(deps, record);
    if (outcome.kind === "PUBLISHED") published += 1;
    else if (outcome.kind === "FAILED") failed += 1;
    else stillPending += 1;
  }

  return { attempted: candidates.length, published, failed, stillPending };
}
