/**
 * DispatchOutboxRelay + OutboxSweeperReminderDispatch core logic (M3.5,
 * docs/architecture/m3.5-runtime-design.md "Decisão central: outbox durável"). Pure(ish) -
 * injected store/queue/clock, no AWS SDK/Lambda runtime dependency, same pattern as
 * src/workers/reminder-producer/producer.ts.
 *
 * Both the relay (triggered per-record by DynamoDB Streams) and the sweeper (triggered on
 * a schedule, sourcing candidates via `listPendingReminderDispatch`) call the SAME
 * `publishOne` - the only difference is how they discover which records to attempt.
 *
 * M4 (docs/architecture/m4-notification-engine-design.md §7.4, fechamento de rodada 1)
 * generalizes this from a single hardcoded destination (SQS_REMINDER_DISPATCH_V1) to an
 * explicit router keyed by `destination` - a second sweeper querying the SAME global GSI6
 * partition (`RECON#OUTBOX#PENDING`) for a second destination would be redundant; the
 * existing sweeper role is already privileged for GSI6 and just needs to dispatch to the
 * right queue sender per record.
 */
import { runWithContext } from "../../shared/observability/context.js";
import { outboxRecordCorrelationId, type OutboxRecord, type OutboxDestination } from "../../shared/outbox/outbox.js";
import type { OutboxRelayStore } from "../../shared/outbox/relay-store.js";

export const SQS_REMINDER_DISPATCH_V1: OutboxDestination = "SQS_REMINDER_DISPATCH_V1";
export const SQS_NOTIFICATION_EMAIL_V1: OutboxDestination = "SQS_NOTIFICATION_EMAIL_V1";

/** One sender per recognized destination - a record whose `destination` has no entry here
 * is not this relay/sweeper's to touch (SKIPPED_WRONG_DESTINATION), same exclusivity
 * discipline as the single-destination M3.5 version. */
export type DestinationSenders = Partial<
  Record<OutboxDestination, (payload: Record<string, unknown>, correlationId: string) => Promise<void>>
>;

export interface RelayDeps {
  store: OutboxRelayStore;
  senders: DestinationSenders;
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
  const send = record.destination ? deps.senders[record.destination] : undefined;
  if (!send) {
    return { kind: "SKIPPED_WRONG_DESTINATION" };
  }
  if (record.status === "PUBLISHED") {
    return { kind: "SKIPPED_ALREADY_PUBLISHED" };
  }

  // m5-observability-design.md #2: one runWithContext per record - correlationId read from
  // the persisted OutboxRecord (the business operation that originally created it), never
  // from this invocation's own ambient context.
  return runWithContext({ correlationId: outboxRecordCorrelationId(record) }, () => publishAcquiredOrPending(deps, record, send));
}

async function publishAcquiredOrPending(
  deps: RelayDeps,
  record: OutboxRecord,
  send: (payload: Record<string, unknown>, correlationId: string) => Promise<void>,
): Promise<PublishOutcome> {
  const leaseDurationMs = deps.leaseDurationMs ?? 30_000;
  const now = deps.now();
  const leaseExpiresAt = new Date(Date.parse(now) + leaseDurationMs).toISOString();

  const acquired = await deps.store.tryAcquireLease({ PK: record.PK, SK: record.SK }, deps.leaseOwner, leaseExpiresAt, now);
  if (!acquired) {
    return { kind: "SKIPPED_LEASE_HELD" };
  }

  try {
    await send(record.payload, outboxRecordCorrelationId(record));
  } catch (error) {
    // Failure here is expected and recoverable: the lease expires, the sweeper (or a later
    // Stream retry) will retry. A duplicate SendMessage after a retry is absorbed by the
    // downstream worker's own idempotency - never treated as a reason to skip retrying.
    return { kind: "FAILED", error };
  }

  // Transition PENDING -> PUBLISHED only AFTER SendMessage confirmed (m3.5-runtime-design.md:
  // "falha entre (2) e (3) é aceitável - duplicata é absorvida pela idempotência do
  // dispatch"). Failure here also just means the sweeper resends a message that was
  // already delivered once - still recoverable, not a correctness issue.
  await deps.store.markPublished({ PK: record.PK, SK: record.SK });
  return { kind: "PUBLISHED" };
}

/** DispatchOutboxRelay / NotificationEmailOutboxRelay entrypoint logic: one call per
 * DynamoDB Streams record (NEW_IMAGE). Which record types actually flow through a given
 * Lambda's Streams filter, and thus which `senders` it needs, is a wiring concern, not this
 * function's - it stays destination-agnostic. */
export async function relayStreamRecord(deps: RelayDeps, record: OutboxRecord): Promise<PublishOutcome> {
  return publishOne(deps, record);
}

export interface SweeperDeps extends RelayDeps {
  /** Minimum age (ms) before a PENDING record is swept - covers relay/Stream failure, not
   * normal in-flight latency (m3.5-runtime-design.md: "occurredAt mais antigo que um
   * limiar (2 min)"). */
  minAgeMs?: number;
  pageSize?: number;
  /** Which destinations to sweep this run - the sweeper queries GSI6 once per destination
   * (same global partition, `RECON#OUTBOX#PENDING`, filtered by `destination` server-side by
   * the store). Defaults to every destination this deps' `senders` map recognizes. */
  destinations?: OutboxDestination[];
}

export interface SweepResult {
  attempted: number;
  published: number;
  failed: number;
  stillPending: number;
}

/** OutboxSweeperReminderDispatch/OutboxSweeperNotificationEmail entrypoint logic: no backoff
 * of its own - every scheduled execution IS one retry attempt (m3.5-runtime-design.md:
 * "nenhum backoff próprio"). One sweeper instance can cover multiple destinations (M4
 * §7.4: "não proponho outro GSI nem scan... o sweeper existente deve evoluir para um
 * roteador explícito por destination"). */
export async function sweepPendingDispatch(deps: SweeperDeps): Promise<SweepResult> {
  const minAgeMs = deps.minAgeMs ?? 2 * 60_000;
  const olderThan = new Date(Date.parse(deps.now()) - minAgeMs).toISOString();
  const destinations = deps.destinations ?? (Object.keys(deps.senders) as OutboxDestination[]);

  let attempted = 0;
  let published = 0;
  let failed = 0;
  let stillPending = 0;

  for (const destination of destinations) {
    const candidates = await deps.store.listPendingReminderDispatch({
      destination,
      olderThan,
      pageSize: deps.pageSize,
    });

    attempted += candidates.length;
    for (const record of candidates) {
      const outcome = await publishOne(deps, record);
      if (outcome.kind === "PUBLISHED") published += 1;
      else if (outcome.kind === "FAILED") failed += 1;
      else stillPending += 1;
    }
  }

  return { attempted, published, failed, stillPending };
}
