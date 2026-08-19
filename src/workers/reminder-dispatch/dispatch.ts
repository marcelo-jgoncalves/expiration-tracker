/**
 * Reminder dispatch worker core logic - implementation-blueprint.md §9.4. Consumes one
 * `reminder.dispatch.v1` command (produced by the ReminderProducer, §9.3) and performs the
 * CLAIMED -> TRIGGERED transition, creating exactly one `NotificationIntent` idempotently.
 *
 * Validation order per §9.4: occurrence must be CLAIMED (not SCHEDULED directly - the claim
 * prevents double-processing by two concurrent dispatch workers); item must be ACTIVE;
 * versions must match; schedule must be within tolerance; policy must still exist. If any
 * check fails, the occurrence is conditionally cancelled (CLAIMED -> CANCELLED) instead of
 * silently dropped, and repair is left to reconciliation (§9.5) - never a new ad-hoc
 * materialization from inside dispatch.
 *
 * On success, everything commits in ONE TransactWriteItems (§9.4: "corrige a lacuna de
 * durabilidade... antes o evento era tratado como reconstruível sem outbox"):
 * NotificationIntent Put + occurrence CLAIMED->TRIGGERED Update + idempotency record Put
 * (`tenantId|occurrenceId`, §9.4's exact key for NotificationIntentCreated consumers) +
 * outbox `notification.intent-created.v1` Put.
 */
import { buildVersionedUpdate } from "../../shared/dynamodb/occ.js";
import { appendToTransaction } from "../../shared/outbox/outbox.js";
import { buildIdempotencyKey } from "../../shared/idempotency/idempotency.js";
import type { DomainEvent } from "../../shared/contracts/events.js";
import { itemKey } from "../../modules/expiration/domain/expiration-item.js";
import { policyKey, type ReminderPolicy } from "../../modules/reminder/domain/reminder-policy.js";
import type { ReminderOccurrence } from "../../modules/reminder/domain/reminder-occurrence.js";
import { intentKey, type NotificationIntent } from "../../modules/reminder/domain/notification-intent.js";
import { isTransactionCanceled, type ReminderStore, type TransactWriteEntry } from "../../modules/reminder/ports/reminder-store.js";
import type { DispatchCommand } from "../reminder-producer/producer.js";

const NOTIFICATION_INTENT_CREATED = "notification.intent-created.v1";

export interface DispatchDeps {
  store: ReminderStore;
  tableName: string;
  now: () => string;
  newIntentId: () => string;
  newEventId: () => string;
  correlationId: () => string;
  /** Max allowed lag between scheduledAt and now before a claimed occurrence is considered stale (default 30 minutes - generous vs. the claim TTL, covers legitimate SQS/Lambda retry delay). */
  toleranceMs?: number;
}

export type DispatchOutcome =
  | { kind: "TRIGGERED"; intent: NotificationIntent }
  | { kind: "ALREADY_TRIGGERED" }
  | { kind: "CANCELLED_STALE"; reason: string }
  | { kind: "SKIPPED_NOT_CLAIMED" };

/** Looks up the occurrence by (itemId, occurrenceId) - occurrences are co-located under the item's own partition (data-model.md §2), but the command doesn't carry the SK's scheduledAt segment, so the worker queries the item's occurrences and finds the match by occurrenceId. Kept here rather than in ReminderStore to avoid growing the port for a single caller. */
async function findOccurrence(store: ReminderStore, tenantId: string, itemId: string, occurrenceId: string): Promise<ReminderOccurrence | undefined> {
  const rows = await store.queryByItem<ReminderOccurrence>(tenantId, itemId);
  return rows.find((r) => r.occurrenceId === occurrenceId);
}

export async function dispatchOccurrence(deps: DispatchDeps, command: DispatchCommand): Promise<DispatchOutcome> {
  const { tenantId } = command;
  const { itemId, occurrenceId, itemVersion, policyVersion } = command.data;

  const occurrence = await findOccurrence(deps.store, tenantId, itemId, occurrenceId);
  if (!occurrence) {
    return { kind: "SKIPPED_NOT_CLAIMED" };
  }
  if (occurrence.status === "TRIGGERED") {
    return { kind: "ALREADY_TRIGGERED" };
  }
  if (occurrence.status !== "CLAIMED") {
    return { kind: "SKIPPED_NOT_CLAIMED" };
  }

  const item = await deps.store.get<{ PK: string; SK: string; status: string; version: number }>(itemKey(tenantId, itemId));
  const policy = await deps.store.get<ReminderPolicy>(policyKey(tenantId, occurrence.policyId));

  const toleranceMs = deps.toleranceMs ?? 30 * 60_000;
  const withinTolerance = Math.abs(Date.parse(deps.now()) - Date.parse(occurrence.scheduledAt)) <= toleranceMs;

  const stale =
    !item ||
    item.status !== "ACTIVE" ||
    item.version !== itemVersion ||
    occurrence.itemVersion !== itemVersion ||
    !policy ||
    policy.version !== policyVersion ||
    !policy.enabled ||
    !withinTolerance;

  if (stale) {
    const reason = !item
      ? "ITEM_NOT_FOUND"
      : item.status !== "ACTIVE"
        ? "ITEM_NOT_ACTIVE"
        : item.version !== itemVersion || occurrence.itemVersion !== itemVersion
          ? "ITEM_VERSION_MISMATCH"
          : !policy || !policy.enabled
            ? "POLICY_GONE_OR_DISABLED"
            : policy.version !== policyVersion
              ? "POLICY_VERSION_MISMATCH"
              : "OUT_OF_TOLERANCE";

    try {
      await deps.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key: { PK: occurrence.PK, SK: occurrence.SK },
            tenantId,
            expectedVersion: occurrence.version,
            set: { status: "CANCELLED" },
            // M3.5: the claim's WORKSTATE#CLAIMED GSI6 pointer (written by the producer)
            // stops applying the moment this claim is resolved - leaving it would make the
            // reconciliation job find a claim that's already been handled.
            remove: ["GSI6PK", "GSI6SK"],
          }),
        },
      ]);
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
    }
    return { kind: "CANCELLED_STALE", reason };
  }

  const now = deps.now();
  const intentId = deps.newIntentId();
  const intent: NotificationIntent = {
    ...intentKey(tenantId, intentId),
    entityType: "NotificationIntent",
    intentId,
    tenantId,
    kind: "EXPIRATION_REMINDER",
    itemId,
    occurrenceId,
    itemVersion,
    policyId: occurrence.policyId,
    policyVersion,
    scheduledAt: occurrence.scheduledAt,
    requestedChannels: policy.channels.filter((c) => !(policy.optOutChannels ?? []).includes(c)),
    status: "PENDING",
    supersedesIntentId: null,
    correctionReason: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const entries: TransactWriteEntry[] = [
    { Put: { TableName: deps.tableName, Item: { ...intent }, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    {
      Update: buildVersionedUpdate({
        tableName: deps.tableName,
        key: { PK: occurrence.PK, SK: occurrence.SK },
        tenantId,
        expectedVersion: occurrence.version,
        set: { status: "TRIGGERED" },
        remove: ["GSI6PK", "GSI6SK"],
      }),
    },
  ];

  // Idempotency record for NotificationIntentCreated consumers (§9.4: "tenantId|occurrenceId").
  const idem = buildIdempotencyKey(deps.tableName, tenantId, "reminder.dispatch", occurrenceId);
  entries.push({
    Put: {
      TableName: deps.tableName,
      Item: {
        PK: idem.PK,
        SK: idem.SK,
        entityType: "IdempotencyRecord",
        tenantId,
        operation: "reminder.dispatch",
        requestHash: occurrenceId,
        status: "COMPLETED",
        responseRef: intentId,
        expiresAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60_000).toISOString(),
        createdAt: now,
        completedAt: now,
      },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  });

  const event: DomainEvent = {
    specVersion: "1.0",
    eventId: deps.newEventId(),
    eventType: NOTIFICATION_INTENT_CREATED,
    source: "expiration-tracker.reminder",
    occurredAt: now,
    correlationId: deps.correlationId(),
    tenantId,
    actor: { type: "SYSTEM" },
    aggregate: { type: "NotificationIntent", id: intentId, version: 1 },
    data: {
      intentId,
      kind: "EXPIRATION_REMINDER",
      itemId,
      occurrenceId,
      itemVersion,
      policyId: occurrence.policyId,
      policyVersion,
      scheduledAt: occurrence.scheduledAt,
      requestedChannels: intent.requestedChannels,
      status: "PENDING",
      supersedesIntentId: null,
      correctionReason: null,
    },
  };
  appendToTransaction(entries as never, deps.tableName, event);

  try {
    await deps.store.transactWrite(entries);
  } catch (err) {
    if (isTransactionCanceled(err)) {
      // Duplicate delivery of the same command (SQS at-least-once) racing a prior success -
      // either the idempotency Put or the occurrence's CLAIMED condition already advanced.
      return { kind: "ALREADY_TRIGGERED" };
    }
    throw err;
  }

  return { kind: "TRIGGERED", intent };
}
