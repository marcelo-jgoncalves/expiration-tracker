/**
 * NotificationRouterWorker composition-root logic (M4). Loads the entities decideRouting
 * needs with consistent reads, calls the pure decision function, and translates the result
 * into a SINGLE TransactWriteItems - the router never issues more than one transactional
 * write per intent processed, same discipline as reminder-dispatch.ts.
 *
 * Not itself AWS-SDK-specific (takes NotificationStore, not a DynamoDBDocumentClient), so
 * it stays testable against InMemoryNotificationStore - only the Lambda handler
 * (src/runtime/aws/handlers) wires in the real adapters.
 */
import { itemKey, type ExpirationItem } from "../../expiration/domain/expiration-item.js";
import { policyKey, type ReminderPolicy } from "../../reminder/domain/reminder-policy.js";
import type { NotificationIntent, NotificationChannel } from "../../reminder/domain/notification-intent.js";
import type { NotificationAttemptStatus } from "../domain/notification-attempt.js";
import { notificationAttemptKey, buildNotificationAttemptLookup, type NotificationAttempt } from "../domain/notification-attempt.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../domain/notification-preferences.js";
import { notificationEntitlementsKey, type NotificationEntitlements } from "../domain/notification-entitlements.js";
import type { NotificationRecipientResolver } from "../ports/recipient-resolver.js";
import { resolveCandidateUserId } from "../ports/recipient-resolver.js";
import type { NotificationStore, TransactWriteEntry } from "../ports/notification-store.js";
import { isTransactionCanceled } from "../ports/notification-store.js";
import { decideRouting, type RouterDecision } from "./notification-router.js";
import { correctiveIdempotencyKey } from "./corrective-intent-service.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { buildIdempotencyKey } from "../../../shared/idempotency/idempotency.js";

export interface NotificationRouterWorkflowDeps {
  store: NotificationStore;
  tableName: string;
  recipientResolver: NotificationRecipientResolver;
  now: () => string;
  newAttemptId: () => string;
  newIntentId: () => string;
}

export type RouterWorkflowOutcome =
  | { kind: "NOOP_NOT_PENDING" }
  | { kind: "RETRY"; cause: string }
  | { kind: "STALE_REPLACEMENT" | "STALE_CORRECTIVE" }
  | { kind: "CANCELLED"; reason: string }
  | { kind: "ROUTED"; routedChannels: NotificationChannel[] };

function attemptSortKeyDesc(a: { SK: string }, b: { SK: string }): number {
  return a.SK < b.SK ? 1 : a.SK > b.SK ? -1 : 0;
}

/** Processes ONE NotificationIntent (already loaded, e.g. from a DynamoDB Streams NEW_IMAGE)
 * through the router's decision + a single transactional write. Idempotent by construction:
 * a duplicate Streams delivery of the same intent finds it no longer PENDING (already
 * DISPATCHED/CANCELLED/STALE-superseded) and returns NOOP_NOT_PENDING without side effects. */
export async function routeNotificationIntent(deps: NotificationRouterWorkflowDeps, intent: NotificationIntent): Promise<RouterWorkflowOutcome> {
  if (intent.status !== "PENDING") {
    return { kind: "NOOP_NOT_PENDING" };
  }

  const now = deps.now();

  const item = await deps.store.get<ExpirationItem>(itemKey(intent.tenantId, intent.itemId), true);
  const policy = await deps.store.get<ReminderPolicy>(policyKey(intent.tenantId, intent.policyId), true);

  const candidateUserId = resolveCandidateUserId({ assigneeUserId: item?.assigneeUserId });
  const candidateWasEmpty = candidateUserId.trim().length === 0;
  const resolved = candidateWasEmpty ? undefined : await deps.recipientResolver.resolve({ tenantId: intent.tenantId, candidateUserId });

  const entitlements = await deps.store.get<NotificationEntitlements>(notificationEntitlementsKey(intent.tenantId), true);
  const preferences = resolved
    ? await deps.store.get<NotificationPreferences>(notificationPreferencesKey(intent.tenantId, resolved.userId), true)
    : undefined;

  const priorAttempts = await deps.store.queryAttemptsByIntent<NotificationAttempt>(intent.tenantId, intent.intentId);
  const latestAttempt = [...priorAttempts].sort(attemptSortKeyDesc)[0];
  const latestAttemptStatus: NotificationAttemptStatus | undefined = latestAttempt?.status;

  const decision: RouterDecision = decideRouting({
    intent: { itemVersion: intent.itemVersion, policyVersion: intent.policyVersion, requestedChannels: intent.requestedChannels },
    item: item ? { version: item.version, status: item.status === "ACTIVE" ? "ACTIVE" : "ARCHIVED" } : undefined,
    policy: policy ? { version: policy.version, enabled: policy.enabled, requiresCommunication: policy.enabled } : undefined,
    recipient: { resolved: resolved ? { userId: resolved.userId, active: resolved.active } : undefined, candidateWasEmpty },
    entitlement: { emailEnabled: entitlements ? entitlements.email.enabled : undefined },
    preference: { emailEnabled: preferences ? preferences.emailEnabled : undefined, quietHours: preferences?.quietHours ?? undefined },
    latestAttemptStatus,
    now,
  });

  return applyDecision(deps, intent, decision, now, item, policy);
}

async function applyDecision(
  deps: NotificationRouterWorkflowDeps,
  intent: NotificationIntent,
  decision: RouterDecision,
  now: string,
  currentItem: ExpirationItem | undefined,
  currentPolicy: ReminderPolicy | undefined,
): Promise<RouterWorkflowOutcome> {
  if (decision.kind === "RETRY") {
    // No write at all - let the caller (Streams handler) surface this as a batch item
    // failure so the SAME record is retried, never silently dropped.
    return { kind: "RETRY", cause: decision.cause };
  }

  if (decision.kind === "CANCELLED_ALL") {
    try {
      await deps.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key: { PK: intent.PK, SK: intent.SK },
            tenantId: intent.tenantId,
            expectedVersion: intent.version,
            now,
            set: {
              status: "CANCELLED",
              cancelledChannels: intent.requestedChannels.map((channel) => ({ channel, reason: decision.reason })),
              routedAt: now,
            },
          }),
        },
      ]);
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
    }
    return { kind: "CANCELLED", reason: decision.reason };
  }

  if (decision.kind === "STALE") {
    // The whole point of REPLACEMENT/CORRECTIVE is to reflect the CURRENT item/policy
    // version, never the stale intent's own (that's precisely what made it stale). `item`
    // is guaranteed loaded here (decideRouting only reaches STALE after confirming the item
    // exists/is ACTIVE), but a STALE triggered purely by item-version mismatch can be
    // decided before the policy is ever inspected - `currentPolicy` may genuinely be
    // undefined (e.g. policy row deleted); fall back to the old value rather than crash.
    const itemVersion = currentItem?.version ?? intent.itemVersion;
    const policyVersion = currentPolicy?.version ?? intent.policyVersion;
    return applyStaleDecision(deps, intent, decision.correctiveKind, now, itemVersion, policyVersion);
  }

  // ROUTED
  return applyRoutedDecision(deps, intent, decision, now);
}

/** Minimal shape applyStaleDecision needs - structurally satisfied by both
 * NotificationRouterWorkflowDeps and EmailDeliveryWorkflowDeps, so the delivery worker (which
 * also detects staleness, immediately before the external call) can reuse the exact same
 * REPLACEMENT/CORRECTIVE construction logic instead of a second implementation. */
export interface CorrectiveIntentDeps {
  store: NotificationStore;
  tableName: string;
  newIntentId: () => string;
}

/** Exported for email-delivery-workflow.ts's own staleness check (design: "a mudança de
 * versão pode acontecer entre o router e o delivery worker também"). Returns the
 * corrective kind actually applied, alongside the same RouterWorkflowOutcome the router uses. */
export async function applyStaleDeliveryDecision(
  deps: CorrectiveIntentDeps,
  intent: NotificationIntent,
  correctiveKind: "REPLACEMENT" | "CORRECTIVE",
  now: string,
  currentItemVersion: number,
  currentPolicyVersion: number,
): Promise<{ correctiveKind: "REPLACEMENT" | "CORRECTIVE" }> {
  await applyStaleDecision(deps, intent, correctiveKind, now, currentItemVersion, currentPolicyVersion);
  return { correctiveKind };
}

async function applyStaleDecision(
  deps: CorrectiveIntentDeps,
  intent: NotificationIntent,
  correctiveKind: "REPLACEMENT" | "CORRECTIVE",
  now: string,
  currentItemVersion: number,
  currentPolicyVersion: number,
): Promise<RouterWorkflowOutcome> {
  const newIntentId = deps.newIntentId();
  const idemKey = correctiveIdempotencyKey({
    tenantId: intent.tenantId,
    supersededIntentId: intent.intentId,
    currentItemVersion,
    kind: correctiveKind,
  });
  const idem = buildIdempotencyKey(deps.tableName, intent.tenantId, "notification.corrective", idemKey);

  const newIntent: NotificationIntent = {
    PK: `TENANT#${intent.tenantId}#INTENT#${newIntentId}`,
    SK: "META",
    entityType: "NotificationIntent",
    intentId: newIntentId,
    tenantId: intent.tenantId,
    kind: correctiveKind,
    itemId: intent.itemId,
    occurrenceId: intent.occurrenceId,
    itemVersion: currentItemVersion,
    policyId: intent.policyId,
    policyVersion: currentPolicyVersion,
    scheduledAt: intent.scheduledAt,
    requestedChannels: intent.requestedChannels,
    status: "PENDING",
    supersedesIntentId: intent.intentId,
    correctionReason: correctiveKind === "CORRECTIVE" ? "ITEM_VERSION_CHANGED_BEFORE_SEND" : null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const entries: TransactWriteEntry[] = [
    {
      Update: buildVersionedUpdate({
        tableName: deps.tableName,
        key: { PK: intent.PK, SK: intent.SK },
        tenantId: intent.tenantId,
        expectedVersion: intent.version,
        now,
        set: { status: "CANCELLED", cancelledChannels: intent.requestedChannels.map((channel) => ({ channel, reason: "STALE_ITEM_VERSION" })) },
      }),
    },
    { Put: { TableName: deps.tableName, Item: { ...newIntent }, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } },
    {
      Put: {
        TableName: deps.tableName,
        Item: {
          PK: idem.PK,
          SK: idem.SK,
          entityType: "IdempotencyRecord",
          tenantId: intent.tenantId,
          operation: "notification.corrective",
          requestHash: idemKey,
          status: "COMPLETED",
          responseRef: newIntentId,
          expiresAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60_000).toISOString(),
          createdAt: now,
          completedAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    },
  ];

  try {
    await deps.store.transactWrite(entries);
  } catch (err) {
    if (!isTransactionCanceled(err)) throw err;
    // Idempotency record already exists (or the intent was already superseded by a
    // concurrent invocation) - not a failure, just a duplicate we don't need to redo.
  }

  return correctiveKind === "REPLACEMENT" ? { kind: "STALE_REPLACEMENT" } : { kind: "STALE_CORRECTIVE" };
}

async function applyRoutedDecision(
  deps: NotificationRouterWorkflowDeps,
  intent: NotificationIntent,
  decision: Extract<RouterDecision, { kind: "ROUTED" }>,
  now: string,
): Promise<RouterWorkflowOutcome> {
  const entries: TransactWriteEntry[] = [
    {
      Update: buildVersionedUpdate({
        tableName: deps.tableName,
        key: { PK: intent.PK, SK: intent.SK },
        tenantId: intent.tenantId,
        expectedVersion: intent.version,
        now,
        set: {
          status: "DISPATCHED",
          routedChannels: decision.routedChannels,
          cancelledChannels: decision.cancelledChannels,
          routedAt: now,
        },
      }),
    },
  ];

  for (const channel of decision.routedChannels) {
    if (channel !== "EMAIL") continue; // only EMAIL has a real delivery path in M4
    const attemptId = deps.newAttemptId();
    const attemptNumber = 1;
    const attempt: NotificationAttempt = {
      ...notificationAttemptKey(intent.tenantId, intent.intentId, attemptNumber, attemptId),
      entityType: "NotificationAttempt",
      tenantId: intent.tenantId,
      intentId: intent.intentId,
      attemptId,
      attemptNumber,
      redriveGeneration: 0,
      channel: "EMAIL",
      provider: "SES",
      providerAccountId: "default",
      status: "PREPARED",
      expectedItemVersion: intent.itemVersion,
      commandMessageId: attemptId,
      destinationHash: "",
      templateId: "expiration-reminder",
      templateVersion: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    entries.push({ Put: { TableName: deps.tableName, Item: { ...attempt }, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } });

    const lookup = buildNotificationAttemptLookup(attempt);
    entries.push({ Put: { TableName: deps.tableName, Item: { ...lookup }, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" } });

    entries.push({
      Put: {
        TableName: deps.tableName,
        Item: buildEmailOutboxRecord(intent, attempt, decision.deliverNotBefore, now),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    });
  }

  try {
    await deps.store.transactWrite(entries);
  } catch (err) {
    if (!isTransactionCanceled(err)) throw err;
  }

  return { kind: "ROUTED", routedChannels: decision.routedChannels };
}

function monthShard(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7).replace("-", "");
}

/** Builds the OutboxEvent record for the notification.email-deliver.v1 command, same shape
 * shared/outbox/outbox.ts's buildOutboxRecord produces, with `destination:
 * "SQS_NOTIFICATION_EMAIL_V1"` (fechamento §7 do design) - inlined here (not via
 * appendToTransaction, which takes a DomainEvent) because the payload IS the SQS command
 * envelope directly, matching the same pattern reminder-producer.ts uses for its own
 * dispatch command outbox record. */
function buildEmailOutboxRecord(intent: NotificationIntent, attempt: NotificationAttempt, deliverNotBefore: string | undefined, now: string): Record<string, unknown> {
  const shard = monthShard(now);
  const eventId = attempt.attemptId;
  return {
    PK: `TENANT#${intent.tenantId}#OUTBOX#${shard}`,
    SK: `EVENT#${now}#${eventId}`,
    entityType: "OutboxEvent",
    // BLOCKER-B added tenantId as an explicit OutboxRecord field (previously only embedded
    // in PK) for a different destination's sender to use - added here too for the same
    // reason (and so every real OutboxEvent row is consistently shaped), even though this
    // destination's own payload already self-describes its tenant.
    tenantId: intent.tenantId,
    eventId,
    eventType: "notification.email-deliver.v1",
    aggregateType: "NotificationAttempt",
    aggregateId: attempt.attemptId,
    aggregateVersion: 1,
    status: "PENDING",
    occurredAt: now,
    payload: {
      messageVersion: 1,
      messageId: attempt.attemptId,
      commandType: "notification.email-deliver.v1",
      createdAt: now,
      correlationId: attempt.attemptId,
      causationId: intent.intentId,
      tenantId: intent.tenantId,
      deduplicationKey: `${intent.tenantId}|${intent.intentId}|EMAIL|${attempt.templateId}|${attempt.attemptNumber}`,
      data: {
        intentId: intent.intentId,
        attemptId: attempt.attemptId,
        itemId: intent.itemId,
        expectedItemVersion: intent.itemVersion,
        channelId: "email-default",
        templateId: attempt.templateId,
        templateVersion: attempt.templateVersion,
        locale: "pt-BR",
        deliverNotBefore: deliverNotBefore ?? now,
        renderContextRef: { type: "EXPIRATION_ITEM", id: intent.itemId },
      },
    },
    publishAttempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    GSI6PK: "RECON#OUTBOX#PENDING",
    GSI6SK: `${now}#${eventId}`,
    destination: "SQS_NOTIFICATION_EMAIL_V1",
  };
}
