/** Real handler for NotificationEmailOutboxRelay (DynamoDB Streams NEW_IMAGE), M4. Same
 * generalized relay logic as DispatchOutboxRelay - see
 * src/workers/dispatch-outbox-relay/relay.ts's header (M4 generalized it to route by
 * `destination` instead of being hardcoded to reminder dispatch). This handler only wires
 * the `senders` map for `SQS_NOTIFICATION_EMAIL_V1` - it never touches
 * `SQS_REMINDER_DISPATCH_V1` records (routing exclusivity is enforced in publishOne itself,
 * this handler's senders map simply doesn't recognize that destination). */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbOutboxRelayStore } from "../../../shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { buildNotificationEmailOutboxRelayDeps } from "../composition/notification.js";
import { relayStreamRecord } from "../../../workers/dispatch-outbox-relay/relay.js";
import type { OutboxRecord } from "../../../shared/outbox/outbox.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const queueUrl = process.env["EMAIL_DELIVER_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!queueUrl) throw new Error("EMAIL_DELIVER_QUEUE_URL env var is required.");

// Reuses the same generic DynamoDbOutboxRelayStore lease/publish bookkeeping already built
// for reminder dispatch (not reminder-specific) - only the `senders` map differs per handler.
const store = new DynamoDbOutboxRelayStore(client, tableName);
const notificationSenders = buildNotificationEmailOutboxRelayDeps(client, tableName, queueUrl).senders;
const deps = { store, now: () => new Date().toISOString(), senders: notificationSenders };
const logger = new SecureLogger({ baseContext: { service: "notification-email-outbox-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") continue;
    const image = record.dynamodb?.NewImage;
    if (!image) continue;

    try {
      const item = unmarshall(image as Record<string, never>) as OutboxRecord;
      if (item.entityType !== "OutboxEvent") continue;
      const outcome = await relayStreamRecord({ ...deps, leaseOwner: `notification-relay-${record.eventID}` }, item);
      logger.info("notification-email-outbox-relay outcome", { eventId: item.eventId, outcome: outcome.kind });
      if (outcome.kind === "FAILED") {
        batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
      }
    } catch (err) {
      logger.error("notification-email-outbox-relay failed", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
    }
  }

  return { batchItemFailures };
}
