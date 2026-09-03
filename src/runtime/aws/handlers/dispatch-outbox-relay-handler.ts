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
// M10 cluster 4 (D-039/D-046/D-048): second destination on the SAME relay Lambda/DynamoDB
// Streams event source mapping - never a new relay function just for this one extra queue.
const chasingQueueUrl = process.env["DOCUMENT_CHASING_DISPATCH_QUEUE_URL"];
// M11 (D-042): third destination, same reasoning.
const importCommitQueueUrl = process.env["IMPORT_COMMIT_QUEUE_URL"];
// BLOCKER-B (reminder-delivery-pipeline.md §4): fourth destination, same reasoning - the
// generic "no destination -> EventBridge" path this design doc originally assumed was never
// actually implemented in this codebase (confirmed during implementation, see outbox.ts's
// OutboxDestination comment), so this is the only real delivery mechanism available.
const materializationTriggerQueueUrl = process.env["REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL"];
// D-192 slice 9: fifth destination, same reasoning.
const importParseQueueUrl = process.env["IMPORT_PARSE_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!queueUrl) throw new Error("DISPATCH_QUEUE_URL env var is required.");
if (!chasingQueueUrl) throw new Error("DOCUMENT_CHASING_DISPATCH_QUEUE_URL env var is required.");
if (!importCommitQueueUrl) throw new Error("IMPORT_COMMIT_QUEUE_URL env var is required.");
if (!materializationTriggerQueueUrl) throw new Error("REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL env var is required.");
if (!importParseQueueUrl) throw new Error("IMPORT_PARSE_QUEUE_URL env var is required.");
const deps = buildOutboxRelayDeps(client, tableName, queueUrl, new SQSClient({}), chasingQueueUrl, importCommitQueueUrl, materializationTriggerQueueUrl, importParseQueueUrl);
const logger = new SecureLogger({ baseContext: { service: "dispatch-outbox-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures = await processStreamRecords(deps, logger, event.Records);
  return { batchItemFailures };
}
