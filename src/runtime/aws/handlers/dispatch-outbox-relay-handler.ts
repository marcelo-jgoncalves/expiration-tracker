/** Real handler for DispatchOutboxRelay (DynamoDB Streams NEW_IMAGE), replacing the 501
 * placeholder. Partial batch failure so a poison record doesn't block the rest of the
 * shard's batch (m3.5-runtime-design.md §"Decisão central"). Per-record processing logic
 * lives in dispatch-outbox-relay-processor.ts (no module-level side effects, unit-testable)
 * - this file is only the thin AWS entrypoint: real env vars, real clients, real deps. */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildOutboxRelayDeps } from "../composition/reminder.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { processStreamRecords } from "./dispatch-outbox-relay-processor.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const queueUrl = process.env["DISPATCH_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!queueUrl) throw new Error("DISPATCH_QUEUE_URL env var is required.");
const deps = buildOutboxRelayDeps(client, tableName, queueUrl, new SQSClient({}));
const logger = new SecureLogger({ baseContext: { service: "dispatch-outbox-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures = await processStreamRecords(deps, logger, event.Records);
  return { batchItemFailures };
}
