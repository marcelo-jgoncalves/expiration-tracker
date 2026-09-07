/** Real handler for NotificationWhatsAppOutboxRelay (DynamoDB Streams NEW_IMAGE), fatia 2/5
 * (D-9). Same generalized relay logic as the email outbox relay - see
 * `notification-email-outbox-relay-handler.ts`'s header - reuses `processStreamRecords`/
 * `relayStreamRecord` verbatim (already generic over `senders`, routing exclusivity enforced in
 * `relayStreamRecord` itself by `destination`, never by this handler's senders map). This
 * handler only wires the `senders` map for `SQS_NOTIFICATION_WHATSAPP_V1` - it never touches
 * any other destination.
 *
 * NOT reachable from the real notification flow yet - nothing writes a
 * `SQS_NOTIFICATION_WHATSAPP_V1` outbox record until `notification-router-workflow.ts` is
 * wired in fatia 5/5. Deployed now so the relay -> queue -> worker chain is testable
 * end-to-end ahead of that wiring (same "consumer exists before its real producer is wired"
 * pattern already used elsewhere in this codebase for pre-wired outbox destinations).
 */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbOutboxRelayStore } from "../../../shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { buildNotificationWhatsAppOutboxRelayDeps } from "../composition/notification.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { processStreamRecords } from "./notification-email-outbox-relay-processor.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const queueUrl = process.env["WHATSAPP_DELIVER_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!queueUrl) throw new Error("WHATSAPP_DELIVER_QUEUE_URL env var is required.");

const store = new DynamoDbOutboxRelayStore(client, tableName);
const whatsAppSenders = buildNotificationWhatsAppOutboxRelayDeps(client, tableName, queueUrl).senders;
const deps = { store, now: () => new Date().toISOString(), senders: whatsAppSenders };
const logger = new SecureLogger({ baseContext: { service: "notification-whatsapp-outbox-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures = await processStreamRecords(deps, logger, event.Records);
  return { batchItemFailures };
}
