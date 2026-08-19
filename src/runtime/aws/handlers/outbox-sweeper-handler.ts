/** Real handler for OutboxSweeperReminderDispatch (EventBridge Scheduler, 5 min),
 * replacing the 501 placeholder. Recovers publications the relay missed (Stream failure,
 * crashed relay invocation) - m3.5-runtime-design.md §"Decisão central". */
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildOutboxRelayDeps } from "../composition/reminder.js";
import { sweepPendingDispatch } from "../../../workers/dispatch-outbox-relay/relay.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const queueUrl = process.env["DISPATCH_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!queueUrl) throw new Error("DISPATCH_QUEUE_URL env var is required.");
const deps = buildOutboxRelayDeps(client, tableName, queueUrl, new SQSClient({}));
const logger = new SecureLogger({ baseContext: { service: "outbox-sweeper-reminder-dispatch" } });

export async function handler(): Promise<void> {
  const result = await sweepPendingDispatch({ ...deps, leaseOwner: `sweeper-${Date.now()}` });
  logger.info("outbox-sweeper-reminder-dispatch complete", { ...result });
}
