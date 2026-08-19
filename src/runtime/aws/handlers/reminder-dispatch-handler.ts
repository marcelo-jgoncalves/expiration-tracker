/** Real handler for ReminderDispatch (SQS ReminderDispatchQueue), replacing the 501
 * placeholder. Partial batch failure (m3.5-runtime-design.md §"SQS + DLQ"): only failed
 * items are reported back, successful/duplicate/already-resolved items in the same batch
 * are never retried. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderDispatchDeps } from "../composition/reminder.js";
import { dispatchOccurrence } from "../../../workers/reminder-dispatch/dispatch.js";
import type { DispatchCommand } from "../../../workers/reminder-producer/producer.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildReminderDispatchDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-dispatch" } });

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const command = JSON.parse(record.body) as DispatchCommand;
      const outcome = await dispatchOccurrence(deps, command);
      logger.info("reminder-dispatch outcome", { messageId: record.messageId, outcome: outcome.kind });
    } catch (err) {
      // Schema-invalid/poison messages and genuine retryable failures both surface here as
      // batch item failures - SQS's own maxReceiveCount+DLQ (not this handler) decides when
      // a poison message stops being retried (m3.5-runtime-design.md §10 "Poison message").
      logger.error("reminder-dispatch failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
