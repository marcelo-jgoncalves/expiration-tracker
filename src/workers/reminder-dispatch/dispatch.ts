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
import { buildVersionConditionCheck, buildVersionedUpdate } from "../../shared/dynamodb/occ.js";
import { appendToTransaction } from "../../shared/outbox/outbox.js";
import { buildIdempotencyKey } from "../../shared/idempotency/idempotency.js";
import type { DomainEvent } from "../../shared/contracts/events.js";
import { itemKey } from "../../modules/expiration/domain/expiration-item.js";
import { policyKey, type ReminderPolicy } from "../../modules/reminder/domain/reminder-policy.js";
import { occurrenceKey, type ReminderOccurrence } from "../../modules/reminder/domain/reminder-occurrence.js";
import { intentKey, type NotificationIntent } from "../../modules/reminder/domain/notification-intent.js";
import { deriveDeliveryRecordMaintenanceDue, deliveryRecordGsi8Keys } from "../../shared/delivery-record-gsi8.js";
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
  | { kind: "SKIPPED_NOT_CLAIMED" }
  | { kind: "ABORTED_FRESHNESS_RACE" };

/** Looks up the occurrence by its exact key - the command carries `scheduledAt` (the SK's
 * own segment, see DispatchCommand.data in producer.ts), so this is a direct GetItem, not
 * the N+1 `queryByItem` + in-memory `find()` over every occurrence under the item's
 * partition that used to run here (perf audit D-170: level 1-4 mechanical fix). */
async function findOccurrence(
  store: ReminderStore,
  tenantId: string,
  itemId: string,
  occurrenceId: string,
  scheduledAt: string,
): Promise<ReminderOccurrence | undefined> {
  return store.get<ReminderOccurrence>(occurrenceKey(tenantId, itemId, scheduledAt, occurrenceId));
}

export async function dispatchOccurrence(deps: DispatchDeps, command: DispatchCommand): Promise<DispatchOutcome> {
  const { tenantId } = command;
  const { itemId, occurrenceId, itemVersion, policyVersion, scheduledAt } = command.data;

  const occurrence = await findOccurrence(deps.store, tenantId, itemId, occurrenceId, scheduledAt);
  if (!occurrence) {
    return { kind: "SKIPPED_NOT_CLAIMED" };
  }
  if (occurrence.status === "TRIGGERED") {
    return { kind: "ALREADY_TRIGGERED" };
  }
  if (occurrence.status !== "CLAIMED") {
    return { kind: "SKIPPED_NOT_CLAIMED" };
  }

  // D-170: independent reads (item, policy), fetched concurrently rather than sequentially.
  const [item, policy] = await Promise.all([
    deps.store.get<{ PK: string; SK: string; status: string; version: number }>(itemKey(tenantId, itemId)),
    deps.store.get<ReminderPolicy>(policyKey(tenantId, occurrence.policyId)),
  ]);

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
      // Codex Round E/F finding: mirrors D2's exact defect on this second, older
      // transaction - TransactionCanceledException is not synonymous with "the occurrence's
      // own condition lost" (throttling/other cancellation reasons must be retried, not
      // silently treated as an already-resolved stale occurrence). Only entry 0 (this
      // transaction's sole Update) failing its own ConditionalCheckFailed is provably safe
      // to swallow - Round F caught that the first fix still fell through to "swallow" when
      // `CancellationReasons` was absent entirely (`reasons && !occurrenceConditionFailed`
      // is falsy when `reasons` is undefined); this must rethrow whenever it cannot prove
      // the specific reason, exactly like the success-path catch below already does.
      const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
      const occurrenceConditionFailed = reasons?.[0]?.Code === "ConditionalCheckFailed";
      if (!isTransactionCanceled(err) || !occurrenceConditionFailed) throw err;
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

  const intentGsi8 = deliveryRecordGsi8Keys({
    dueAtIso: deriveDeliveryRecordMaintenanceDue({ createdAt: intent.createdAt }).dueAtIso,
    tenantId: intent.tenantId,
    entityType: "NotificationIntent",
    sk: intent.SK,
  });

  const entries: TransactWriteEntry[] = [
    {
      Put: {
        TableName: deps.tableName,
        Item: { ...intent, ...intentGsi8 },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    },
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
    // Freshness fence (BLOCKER-B, Codex Round B CRITICAL finding): the `stale` check above
    // reads item/policy moments before this transaction commits - without re-asserting those
    // exact facts atomically here, a policy disable/update or item archive/delete landing in
    // that gap would still produce a real NotificationIntent for an item/policy that is no
    // longer current by the time this transaction is durable. Re-asserted as ConditionChecks
    // (not re-reads) so the whole transaction, including the NotificationIntent Put, is
    // atomically gated on both still holding.
    buildVersionConditionCheck({ tableName: deps.tableName, key: itemKey(tenantId, itemId), expectedVersion: itemVersion, extra: { status: "ACTIVE" } }),
    buildVersionConditionCheck({
      tableName: deps.tableName,
      key: policyKey(tenantId, occurrence.policyId),
      expectedVersion: policyVersion,
      extra: { enabled: true },
    }),
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
  appendToTransaction(entries, deps.tableName, event);

  try {
    await deps.store.transactWrite(entries);
  } catch (err) {
    if (isTransactionCanceled(err)) {
      // Codex Round D real defect fix: entry index alone doesn't prove which race occurred -
      // ANY entry can fail (throttling, a genuine idempotency collision at index 4, an
      // unrelated outbox condition at index 5), and treating every cancellation as one of
      // this handler's two known-safe outcomes silently swallowed failures the SQS handler
      // needs to retry (it acks every returned outcome, never just an exception - see
      // reminder-dispatch-handler.ts). Only the SPECIFIC entries whose failure is provably
      // safe to swallow are recognized here; everything else rethrows so the caller retries.
      const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
      const failed = (i: number) => reasons?.[i]?.Code === "ConditionalCheckFailed";

      // Entry 1: the occurrence's own CLAIMED->TRIGGERED condition already advanced -
      // duplicate delivery of the same command racing a prior success on THIS occurrence.
      if (failed(1)) {
        return { kind: "ALREADY_TRIGGERED" };
      }
      // Entries 2/3: the freshness fence itself lost a race against a concurrent
      // policy/item change - the occurrence is untouched (still CLAIMED), correctly
      // re-evaluated by a later dispatch attempt or reconciliation, never a duplicate send.
      if (failed(2) || failed(3)) {
        return { kind: "ABORTED_FRESHNESS_RACE" };
      }
      // Any other cancellation (idempotency/outbox condition, throttling, missing
      // CancellationReasons from a non-conforming store) is not provably safe to treat as a
      // known no-op outcome - rethrow so the handler reports it as a batch item failure and
      // SQS retries, rather than silently acknowledging an unexplained failure.
      throw err;
    }
    throw err;
  }

  return { kind: "TRIGGERED", intent };
}
