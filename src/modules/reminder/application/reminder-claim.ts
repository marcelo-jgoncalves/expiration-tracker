/**
 * Reminder-side claim helper - D-300
 * (`docs/architecture/reviews/reminder-producer-implementation-plan-scoping/DECISION.md` §1):
 * "claimReminderOccurrence (nova, extraída, espelha a forma de claimChasingOccurrence já
 * existente em producer.ts:200-214)". Extracted from the reminder branch of
 * `runProducerTick`'s scan loop (`workers/reminder-producer/producer.ts`) so BOTH the existing
 * EventBridge-driven producer AND the new claim-consumer Lambda (consuming
 * `SQS_REMINDER_CLAIM_CANDIDATE_V1` candidates published by `scan-page.ts`) share the exact same
 * conditional SCHEDULED -> CLAIMED transition + outbox-durable dispatch, instead of two
 * near-identical copies drifting apart over time. Mirrors
 * `src/modules/subject/application/document-chasing-producer.ts`'s `claimChasingOccurrence`
 * shape deliberately - same deps shape, same outcome union, same transaction pattern.
 */
import { buildVersionedUpdate, type EntityKey, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { isSoleConditionalCancellation } from "../../../shared/dynamodb/occ.js";
import { appendToTransaction, type DynamoTransactPutEntry } from "../../../shared/outbox/outbox.js";
import { GSI6PK_WORKSTATE_CLAIMED, buildExpiredClaimGsi6Sk } from "../ports/reconciliation-candidate-source.js";
import type { DomainEvent } from "../../../shared/contracts/events.js";
import type { ReminderOccurrence } from "../domain/reminder-occurrence.js";

export interface ReminderClaimStore {
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

/** Same shape as `producer.ts`'s `DispatchCommand` - kept as its own type here (not imported
 * from `producer.ts`) so this module has no dependency on the file it was extracted OUT of;
 * `producer.ts` imports this module, never the reverse. */
export interface ReminderDispatchCommand {
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

export interface ReminderClaimDeps {
  store: ReminderClaimStore;
  tableName: string;
  now: () => string;
  claimTtlMs: number;
  newEventId: () => string;
  correlationId: () => string;
}

export type ReminderClaimOutcome =
  | { kind: "CLAIMED"; command: ReminderDispatchCommand }
  | { kind: "SKIPPED_NOT_SCHEDULED" }
  | { kind: "SKIPPED_NOT_DUE" }
  | { kind: "SKIPPED_NOT_EXPIRED" }
  | { kind: "LOST_CLAIM_RACE" };

/** Claims one `ReminderOccurrence` row already read from GSI3 (`baseKey` is the base-table PK/SK
 * a GSI3 row's projection carries) - conditional SCHEDULED -> CLAIMED, same outbox-durable
 * dispatch (`SQS_REMINDER_DISPATCH_V1`) as before extraction, byte-for-byte identical
 * transaction shape to the inline block this replaces in `producer.ts`. `tenantId` is supplied
 * by the caller (already parsed from the GSI3SK by either `producer.ts`'s own scan loop or the
 * new claim-consumer Lambda reading a `ClaimCandidateCommand`) rather than re-derived here, to
 * keep this helper store-agnostic about how the caller arrived at the key.
 * EXPIRED mode renews an expired CLAIMED row plus dispatch outbox in the same
 * version-fenced transaction; PAGED recovery never returns it behind a completed scan. */
export async function claimReminderOccurrence(deps: ReminderClaimDeps, baseKey: EntityKey, tenantId: string, mode: "SCHEDULED" | "EXPIRED" = "SCHEDULED"): Promise<ReminderClaimOutcome> {
  const occurrence = await deps.store.get<ReminderOccurrence>(baseKey);
  if (mode === "EXPIRED" && (!occurrence || occurrence.status !== "CLAIMED" || !occurrence.claimExpiresAt || occurrence.claimExpiresAt > deps.now())) {
    return { kind: "SKIPPED_NOT_EXPIRED" };
  }
  if (!occurrence || (mode === "SCHEDULED" && occurrence.status !== "SCHEDULED")) {
    return { kind: "SKIPPED_NOT_SCHEDULED" };
  }
  if (mode === "SCHEDULED" && occurrence.scheduledAt > deps.now()) {
    return { kind: "SKIPPED_NOT_DUE" };
  }

  const { occurrenceId } = occurrence;
  const claimExpiresAt = new Date(Date.parse(deps.now()) + deps.claimTtlMs).toISOString();
  const newVersion = occurrence.version + 1;
  const now = deps.now();
  const correlationId = deps.correlationId();

  const command: ReminderDispatchCommand = {
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

  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: occurrence.PK, SK: occurrence.SK },
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
  } catch (err) {
    if (isSoleConditionalCancellation(err, 0)) {
      return { kind: "LOST_CLAIM_RACE" };
    }
    throw err;
  }

  return { kind: "CLAIMED", command };
}
