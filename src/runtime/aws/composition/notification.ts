/** Composition root for the notification module and its async workers against real
 * DynamoDB/SQS/SES (M4). Same pattern as composition/reminder.ts. */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDbNotificationStore } from "../../../modules/notification/persistence/dynamodb-notification-store.js";
import { DynamoDbNotificationRecipientResolver } from "../../../modules/notification/persistence/dynamodb-recipient-resolver.js";
import { SesEmailAdapter, createSesClient } from "../../../modules/notification/providers/ses-email-adapter.js";
import { NotificationPreferencesService } from "../../../modules/notification/application/notification-preferences-service.js";
import type { ExpirationItem } from "../../../modules/expiration/domain/expiration-item.js";
import { UlidIdGenerator } from "../ids.js";

export function buildNotificationHttpDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbNotificationStore(client, tableName);
  const preferences = new NotificationPreferencesService({ store, tableName });
  return { store, preferences };
}

export function buildNotificationRouterDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbNotificationStore(client, tableName);
  const recipientResolver = new DynamoDbNotificationRecipientResolver(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    tableName,
    recipientResolver,
    now: () => new Date().toISOString(),
    newAttemptId: () => ids.newAttemptId(),
    newIntentId: () => ids.newIntentId(),
  };
}

export function buildNotificationEmailOutboxRelayDeps(client: DynamoDBDocumentClient, tableName: string, queueUrl: string, sqsClient: SQSClient = new SQSClient({})) {
  // Reuses the SAME generic DynamoDbOutboxRelayStore/relay logic as the reminder dispatch
  // outbox - see src/workers/dispatch-outbox-relay/relay.ts, generalized in M4 to route by
  // `destination` rather than being hardcoded to a single queue.
  return {
    senders: {
      SQS_NOTIFICATION_EMAIL_V1: async (payload: Record<string, unknown>, correlationId: string) => {
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(payload),
            MessageAttributes: { correlationId: { DataType: "String", StringValue: correlationId } },
          }),
        );
      },
    },
  };
}

/** Wave B2B-11 migrated this from `UserProfile` to `GlobalUser` (closes a sequencing gap - see
 * D-108). Wave B2B-13 (E2E/Adversarial Security, D-112) closes a SEPARATE, more serious gap found
 * in that same fix: reading only `GlobalUser` here (at actual SEND time, which can happen minutes
 * after the notification was routed/admitted) never re-checked `Membership` - a real TOCTOU
 * window where a Membership revoked between routing and delivery still got the e-mail. Reuses
 * `DynamoDbNotificationRecipientResolver` (already the router's authority on eligibility, already
 * unit-tested) instead of reading `GlobalUser` directly - `active:false` (Membership no longer
 * ACTIVE, or GlobalUser suspended) now returns `undefined` here exactly like a recipient the
 * router itself would refuse to route to. */
async function resolveRecipientEmail(client: DynamoDBDocumentClient, tableName: string, tenantId: string, userId: string): Promise<string | undefined> {
  const resolver = new DynamoDbNotificationRecipientResolver(client, tableName);
  const result = await resolver.resolve({ tenantId, candidateUserId: userId });
  return result?.active ? result.email : undefined;
}

/** Placeholder template rendering (see ses-email-adapter.ts's own note) - real
 * locale-aware, versioned templates are a follow-up; this only maps the fields the
 * placeholder subject/body needs. */
function renderTemplate(item: ExpirationItem): Record<string, unknown> {
  return { itemDisplayName: item.name, dueDateLocal: item.dueDate.slice(0, 10), applicationUrl: "" };
}

export function buildEmailDeliveryDeps(client: DynamoDBDocumentClient, tableName: string, sesFromAddress: string, sesConfigurationSet: string, sesClient = createSesClient()) {
  const store = new DynamoDbNotificationStore(client, tableName);
  return {
    store,
    tableName,
    emailProvider: new SesEmailAdapter(sesClient, sesFromAddress, sesConfigurationSet),
    resolveRecipientEmail: (input: { tenantId: string; userId: string }) => resolveRecipientEmail(client, tableName, input.tenantId, input.userId),
    renderTemplate: (input: { item: ExpirationItem }) => renderTemplate(input.item),
    now: () => new Date().toISOString(),
    newIntentId: () => new UlidIdGenerator().newIntentId(),
  };
}

export function buildSesCallbackDeps(client: DynamoDBDocumentClient, tableName: string, providerAccountId: string) {
  const store = new DynamoDbNotificationStore(client, tableName);
  return { store, tableName, providerAccountId, now: () => new Date().toISOString() };
}
