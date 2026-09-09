/**
 * `buildWhatsAppOutboxRecord` (D-9, `whatsapp-channel-scoping/estado-final-consolidado.md`,
 * fatia 2/5). Analogous to `notification-router-workflow.ts`'s own (private)
 * `buildEmailOutboxRecord`. Originally split into its own file so it could be unit-tested ahead
 * of the router wiring (fatia 2/5 did not call it yet); as of D-197 fatia 5/5,
 * `notification-router-workflow.ts`'s `applyRoutedDecision` imports and calls this directly for
 * every routed WHATSAPP channel - kept as its own file (not inlined) since it's still reused
 * standalone by this module's own unit tests.
 *
 * `destination: "SQS_NOTIFICATION_WHATSAPP_V1"` routes through the SAME generic
 * `DynamoDbOutboxRelayStore`/`relayStreamRecord` mechanism the email outbox relay already uses
 * (`workers/dispatch-outbox-relay/relay.ts`) - never the email queue (ADR-0008: each channel
 * gets its own queue + DLQ).
 */
import type { NotificationIntent } from "../../reminder/domain/notification-intent.js";
import type { NotificationAttempt } from "../domain/notification-attempt.js";

function monthShard(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7).replace("-", "");
}

export function buildWhatsAppOutboxRecord(
  intent: NotificationIntent,
  attempt: NotificationAttempt,
  deliverNotBefore: string | undefined,
  now: string,
): Record<string, unknown> {
  const shard = monthShard(now);
  const eventId = attempt.attemptId;
  return {
    PK: `TENANT#${intent.tenantId}#OUTBOX#${shard}`,
    SK: `EVENT#${now}#${eventId}`,
    entityType: "OutboxEvent",
    tenantId: intent.tenantId,
    eventId,
    eventType: "notification.whatsapp-deliver.v1",
    aggregateType: "NotificationAttempt",
    aggregateId: attempt.attemptId,
    aggregateVersion: 1,
    status: "PENDING",
    occurredAt: now,
    payload: {
      messageVersion: 1,
      messageId: attempt.attemptId,
      commandType: "notification.whatsapp-deliver.v1",
      createdAt: now,
      correlationId: attempt.attemptId,
      causationId: intent.intentId,
      tenantId: intent.tenantId,
      deduplicationKey: `${intent.tenantId}|${intent.intentId}|WHATSAPP|${attempt.templateId}|${attempt.attemptNumber}`,
      data: {
        intentId: intent.intentId,
        attemptId: attempt.attemptId,
        itemId: intent.itemId,
        expectedItemVersion: intent.itemVersion,
        channelId: "whatsapp-default",
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
    destination: "SQS_NOTIFICATION_WHATSAPP_V1",
  };
}
