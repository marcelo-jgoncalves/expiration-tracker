/** Composition root for the notification module and its async workers against real
 * DynamoDB/SQS/SES (M4). Same pattern as composition/reminder.ts. */
import { GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDbNotificationStore } from "../../../modules/notification/persistence/dynamodb-notification-store.js";
import { DynamoDbNotificationRecipientResolver } from "../../../modules/notification/persistence/dynamodb-recipient-resolver.js";
import { SesEmailAdapter, createSesClient } from "../../../modules/notification/providers/ses-email-adapter.js";
import { NotificationPreferencesService } from "../../../modules/notification/application/notification-preferences-service.js";
import type { ExpirationItem } from "../../../modules/expiration/domain/expiration-item.js";
import { UlidIdGenerator } from "../ids.js";
import { globalUserKey } from "../../../modules/identity/persistence/global-user-repository.js";

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

/** Wave B2B-11: migrated from `UserProfile` (`TENANT#<tenantId>#USER#<userId>`/PROFILE, only
 * provisioned lazily on first `RequestContext` resolution IN THIS SPECIFIC Organization) to
 * `GlobalUser` (`USER#<userId>`/PROFILE, tenantless) - closes a real sequencing gap: a member who
 * just accepted an invitation has a real ACTIVE `Membership` (`accept-invitation.ts`) before ever
 * resolving a `RequestContext` in that Organization, but `AcceptInvitationService.accept()`
 * already requires their `GlobalUser` to exist (`bff-auth-service.ts`'s `acceptInvitation()`
 * throws otherwise) - so `GlobalUser.emailNormalized` is guaranteed available at exactly the
 * moment a Membership starts existing, unlike the lazy `UserProfile`. `tenantId` no longer used
 * (the key is tenantless) - kept in the exposed signature below for call-site compatibility. */
async function resolveRecipientEmail(client: DynamoDBDocumentClient, tableName: string, userId: string): Promise<string | undefined> {
  const result = await client.send(new GetCommand({ TableName: tableName, Key: globalUserKey(userId), ConsistentRead: true }));
  const globalUser = result.Item as { emailNormalized?: string } | undefined;
  return globalUser?.emailNormalized;
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
    resolveRecipientEmail: (input: { tenantId: string; userId: string }) => resolveRecipientEmail(client, tableName, input.userId),
    renderTemplate: (input: { item: ExpirationItem }) => renderTemplate(input.item),
    now: () => new Date().toISOString(),
    newIntentId: () => new UlidIdGenerator().newIntentId(),
  };
}

export function buildSesCallbackDeps(client: DynamoDBDocumentClient, tableName: string, providerAccountId: string) {
  const store = new DynamoDbNotificationStore(client, tableName);
  return { store, tableName, providerAccountId, now: () => new Date().toISOString() };
}
