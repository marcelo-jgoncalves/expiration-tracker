/**
 * Transactional outbox helper - implementation-blueprint.md #5.1 (OutboxPort) and #5.3
 * (record shape + OutboxPublisher contract). Builds the outbox item + its
 * TransactWriteItems `Put` entry so callers can append it atomically alongside the
 * aggregate write (e.g. ExpirationItem update + ItemDueDateChanged in one transaction,
 * per data-model.md §5).
 */
import type { DomainEvent } from "../contracts/events.js";
import type { TransactPutEntry, TransactWriteEntry } from "../dynamodb/occ.js";

export type OutboxStatus = "PENDING" | "PUBLISHED";

/**
 * M3.5 (docs/architecture/m3.5-runtime-design.md, "Decisão central: outbox durável"):
 * routing discriminator so `OutboxPublisher` (generic, -> EventBridge) and
 * `DispatchOutboxRelay` (new, -> SQS ReminderDispatchQueue) never both claim the same
 * record. `undefined`/absent means "OutboxPublisher's default EventBridge path" (every
 * M2/M3 caller today) - `OutboxPublisher` must explicitly skip any record whose
 * `destination` it doesn't recognize as its own default, never process-by-omission.
 */
export type OutboxDestination =
  | "SQS_REMINDER_DISPATCH_V1"
  | "SQS_NOTIFICATION_EMAIL_V1"
  | "SQS_DOCUMENT_CHASING_DISPATCH_V1"
  | "SQS_IMPORT_COMMIT_V1"
  /** BLOCKER-B (reminder-delivery-pipeline.md §4): the ONLY real delivery path for an
   * outbox record - the "generic EventBridge path" every other destination's comment
   * describes as the default for an unset `destination` was never actually implemented in
   * this codebase (no PutEventsCommand call exists anywhere) - confirmed during BLOCKER-B
   * implementation, not previously known. Every outbox-driven consumer in production is
   * destination-routed through DispatchOutboxRelay; this destination follows the same
   * proven mechanism rather than the never-built one the original design doc assumed. */
  | "SQS_REMINDER_MATERIALIZATION_TRIGGER_V1"
  /** D-192 slice 9 (`bulk-import-documents-requirements-scoping/estado-final-consolidado.md`
   * §3): dispatched in the SAME `TransactWriteItems` as `POST /import-jobs/{jobId}/mapping`'s
   * `AWAITING_MAPPING`->`PARSING` claim, whenever that POST is the one that resolves the claim
   * (never when the job stays `UPLOADED`, mapping-only write). Consumed by the SAME
   * `parseImportJob()`/`import-parse-handler.ts` the S3-event trigger already uses — the two
   * triggers are discriminated only by envelope shape in the Lambda handler, never inside the
   * pure function, per the design. */
  | "SQS_IMPORT_PARSE_V1"
  /** D-193 item 4/9 (`estado-final-consolidado.md` "Transação de confirmação"): written in the
   * SAME `TransactWriteItems` as `confirmFieldForDocumentArchive`'s `DocumentVersion` Update,
   * ONLY when `planDocumentVersionValidityEffect` says `validUntil` actually changed — never
   * unconditionally. The queue/route/worker that consumes this destination
   * (`requirement-evidence-refresh-handler.ts`, a new `GSI_EVIDENCE` reverse index) is D-193
   * item 5/9, a separate slice not yet built — this destination value exists now so the outbox
   * row already carries its final routing discriminator, with nothing downstream wired to it
   * yet (the row simply waits, same "written before its consumer exists" pattern this file's
   * own history has no precedent needing — first use of a destination pre-dating its consumer). */
  | "SQS_REQUIREMENT_EVIDENCE_REFRESH_V1"
  /** D-204 (Roadmap P1 item 15, `scheduled-reports-scoping/estado-final-consolidado.md`
   * decision 4): written in the SAME `TransactWriteItems` as the scheduled worker's claim
   * `Update` on `ReportSubscription` (advances `nextRunAt`, `ConditionCheck` on `version`) —
   * the 2-action cardinality decision 4 names explicitly. Consumed by a new delivery worker
   * (not yet built — this destination value exists now so the outbox row already carries its
   * final routing discriminator, same "written before its consumer exists" pattern
   * `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1` above already established). */
  | "SQS_REPORT_SUBSCRIPTION_DELIVERY_V1";

export interface OutboxRecord {
  PK: string;
  SK: string;
  entityType: "OutboxEvent";
  /** BLOCKER-B addition: previously only embedded in `PK` (`TENANT#<t>#OUTBOX#<shard>`),
   * never its own field - a sender whose payload doesn't already self-describe its tenant
   * (unlike DispatchCommand) needs this explicitly, without every caller re-parsing `PK`. */
  tenantId: string;
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
  /**
   * m5-observability-design.md #2: copied from `DomainEvent.correlationId` (already mandatory
   * on every event) at write time - never read from the ambient AsyncLocalStorage context here,
   * so this stays a pure, environment-agnostic builder. Optional only because records persisted
   * before M5 don't have it (historical data, never written without it again) - readers
   * (relay/sweeper) must fall back to `eventId` when absent, per the design's fallback table.
   */
  correlationId?: string;
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
    tenantId: event.tenantId,
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
    correlationId: event.correlationId,
    ...(destination ? { destination } : {}),
  };
}

/**
 * m5-observability-design.md #2: correlation id a relay/sweeper should use for the record
 * being processed - read from the persisted `OutboxRecord`, never from the caller's own
 * ambient context. Falls back to `eventId` only for records persisted before M5 (missing
 * `correlationId`); this is historical-data compatibility, not a new write path.
 */
export function outboxRecordCorrelationId(record: OutboxRecord): string {
  return record.correlationId ?? record.eventId;
}

/** @deprecated kept as an alias of the shared `TransactPutEntry` (src/shared/dynamodb/occ.ts)
 * for backward compatibility with existing imports - full-audit round1/qualidade found this
 * was a duplicate, structurally-identical declaration of the same shape (same pattern as the
 * expiration-store.ts/reminder-store.ts duplication decisions-log.md E-008 already fixed).
 * Do not add fields here; add them to the shared type instead. */
export type DynamoTransactPutEntry = TransactPutEntry;

/**
 * OutboxPort.append from implementation-blueprint.md #5.1: appends the outbox Put to a
 * caller-supplied TransactWriteItems array (`tx`) rather than writing directly - the caller
 * owns the transaction and includes the aggregate's own conditional update alongside it.
 * Accepts the full `TransactWriteEntry` union (Put | Update) so callers whose transaction
 * also contains Update entries (e.g. reminder dispatch's CLAIMED->TRIGGERED transition) can
 * pass their real array directly, without an unsafe cast to satisfy a narrower Put-only type.
 */
export function appendToTransaction(
  tx: TransactWriteEntry[],
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
