/**
 * Transactional outbox helper - implementation-blueprint.md #5.1 (OutboxPort) and #5.3
 * (record shape + OutboxPublisher contract). Builds the outbox item + its
 * TransactWriteItems `Put` entry so callers can append it atomically alongside the
 * aggregate write (e.g. ExpirationItem update + ItemDueDateChanged in one transaction,
 * per data-model.md §5).
 */
import type { DomainEvent } from "../contracts/events.js";

export type OutboxStatus = "PENDING" | "PUBLISHED";

/**
 * M3.5 (docs/architecture/m3.5-runtime-design.md, "Decisão central: outbox durável"):
 * routing discriminator so `OutboxPublisher` (generic, -> EventBridge) and
 * `DispatchOutboxRelay` (new, -> SQS ReminderDispatchQueue) never both claim the same
 * record. `undefined`/absent means "OutboxPublisher's default EventBridge path" (every
 * M2/M3 caller today) - `OutboxPublisher` must explicitly skip any record whose
 * `destination` it doesn't recognize as its own default, never process-by-omission.
 */
export type OutboxDestination = "SQS_REMINDER_DISPATCH_V1";

export interface OutboxRecord {
  PK: string;
  SK: string;
  entityType: "OutboxEvent";
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  status: OutboxStatus;
  occurredAt: string;
  payload: Record<string, unknown>;
  publishAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  GSI6PK: string;
  GSI6SK: string;
  destination?: OutboxDestination;
}

/** Monthly shard for the outbox partition, matching #5.3's `TENANT#t#OUTBOX#202608` example. */
function monthShard(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7).replace("-", "");
}

export function buildOutboxRecord(event: DomainEvent, destination?: OutboxDestination): OutboxRecord {
  const shard = monthShard(event.occurredAt);
  return {
    PK: `TENANT#${event.tenantId}#OUTBOX#${shard}`,
    SK: `EVENT#${event.occurredAt}#${event.eventId}`,
    entityType: "OutboxEvent",
    eventId: event.eventId,
    eventType: event.eventType,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id,
    aggregateVersion: event.aggregate.version,
    status: "PENDING",
    occurredAt: event.occurredAt,
    payload: event.data,
    publishAttempts: 0,
    nextAttemptAt: event.occurredAt,
    createdAt: event.occurredAt,
    GSI6PK: "RECON#OUTBOX#PENDING",
    GSI6SK: `${event.occurredAt}#${event.eventId}`,
    ...(destination ? { destination } : {}),
  };
}

export interface DynamoTransactPutEntry {
  Put: {
    TableName: string;
    Item: Record<string, unknown>;
    ConditionExpression: string;
  };
}

/**
 * OutboxPort.append from implementation-blueprint.md #5.1: appends the outbox Put to a
 * caller-supplied TransactWriteItems array (`tx`) rather than writing directly - the caller
 * owns the transaction and includes the aggregate's own conditional update alongside it.
 */
export function appendToTransaction(
  tx: DynamoTransactPutEntry[],
  tableName: string,
  event: DomainEvent,
  destination?: OutboxDestination,
): void {
  const record = buildOutboxRecord(event, destination);
  tx.push({
    Put: {
      TableName: tableName,
      Item: { ...record },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  });
}

/** Backoff schedule for OutboxPublisher retries (#5.3 step 6: "incrementa tentativas e
 * aplica backoff"). Exponential with a cap; judgment call - blueprint doesn't pin exact values. */
export function nextAttemptDelayMs(publishAttempts: number): number {
  const base = 1_000;
  const cap = 5 * 60_000;
  return Math.min(cap, base * 2 ** publishAttempts);
}
