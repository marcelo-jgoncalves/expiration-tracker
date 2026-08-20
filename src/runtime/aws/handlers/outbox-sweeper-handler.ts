/** Real handler for the shared outbox sweeper (EventBridge Scheduler, 5 min), covering
 * BOTH SQS_REMINDER_DISPATCH_V1 (M3.5) and SQS_NOTIFICATION_EMAIL_V1 (M4) in a single
 * privileged role - docs/architecture/m4-notification-engine-design.md §7.4: "não proponho
 * outro GSI nem scan... o sweeper existente deve evoluir para um roteador explícito por
 * destination", not a second sweeper querying the same global GSI6 partition. Recovers
 * publications the relay missed (Stream failure, crashed relay invocation) for either
 * destination - m3.5-runtime-design.md §"Decisão central". */
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbOutboxRelayStore } from "../../../shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { sweepPendingDispatch } from "../../../workers/dispatch-outbox-relay/relay.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const reminderDispatchQueueUrl = process.env["DISPATCH_QUEUE_URL"];
const emailDeliverQueueUrl = process.env["EMAIL_DELIVER_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!reminderDispatchQueueUrl) throw new Error("DISPATCH_QUEUE_URL env var is required.");
if (!emailDeliverQueueUrl) throw new Error("EMAIL_DELIVER_QUEUE_URL env var is required.");

const sqsClient = new SQSClient({});
const store = new DynamoDbOutboxRelayStore(client, tableName);
const deps = {
  store,
  now: () => new Date().toISOString(),
  senders: {
    SQS_REMINDER_DISPATCH_V1: async (payload: Record<string, unknown>) => {
      await sqsClient.send(new SendMessageCommand({ QueueUrl: reminderDispatchQueueUrl, MessageBody: JSON.stringify(payload) }));
    },
    SQS_NOTIFICATION_EMAIL_V1: async (payload: Record<string, unknown>) => {
      await sqsClient.send(new SendMessageCommand({ QueueUrl: emailDeliverQueueUrl, MessageBody: JSON.stringify(payload) }));
    },
  },
};
const logger = new SecureLogger({ baseContext: { service: "outbox-sweeper" } });

export async function handler(): Promise<void> {
  const result = await sweepPendingDispatch({ ...deps, leaseOwner: `sweeper-${Date.now()}` });
  logger.info("outbox-sweeper complete", { ...result });
}
