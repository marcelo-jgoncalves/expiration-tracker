/** Real handler for DispatchOutboxRelay (DynamoDB Streams NEW_IMAGE), replacing the 501
 * placeholder. Partial batch failure so a poison record doesn't block the rest of the
 * shard's batch (m3.5-runtime-design.md §"Decisão central"). */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildOutboxRelayDeps } from "../composition/reminder.js";
import { relayStreamRecord } from "../../../workers/dispatch-outbox-relay/relay.js";
import type { OutboxRecord } from "../../../shared/outbox/outbox.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const queueUrl = process.env["DISPATCH_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!queueUrl) throw new Error("DISPATCH_QUEUE_URL env var is required.");
const deps = buildOutboxRelayDeps(client, tableName, queueUrl, new SQSClient({}));
const logger = new SecureLogger({ baseContext: { service: "dispatch-outbox-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") continue;
    const image = record.dynamodb?.NewImage;
    if (!image) continue;

    try {
      const item = unmarshall(image as Record<string, never>) as OutboxRecord;
      if (item.entityType !== "OutboxEvent") continue;
      const outcome = await relayStreamRecord({ ...deps, leaseOwner: `relay-${record.eventID}` }, item);
      logger.info("dispatch-outbox-relay outcome", { eventId: item.eventId, outcome: outcome.kind });
      if (outcome.kind === "FAILED") {
        batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
      }
    } catch (err) {
      logger.error("dispatch-outbox-relay failed", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
    }
  }

  return { batchItemFailures };
}
