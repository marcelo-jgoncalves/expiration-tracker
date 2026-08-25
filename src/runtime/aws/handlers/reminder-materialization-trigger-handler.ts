/** Real handler for ReminderMaterializationTrigger (SQS, BLOCKER-B -
 * docs/architecture/reminder-delivery-pipeline.md §4, Codex Round H APPROVED 9.2/10). Same
 * partial-batch-failure/poison-message discipline as reminder-dispatch-handler.ts: only
 * schema-invalid or genuinely failed records are reported back, so SQS's own
 * maxReceiveCount+DLQ (not this handler) is what stops retries of a message that can never
 * succeed. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderMaterializationTriggerDeps } from "../composition/reminder.js";
import { handleTriggerEvent, parseTriggerEvent, type TriggerMessage } from "../../../workers/reminder-materialization-trigger/trigger.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildReminderMaterializationTriggerDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-materialization-trigger" } });

const TRIGGER_MESSAGE_SCHEMA_ID = "https://expiration-tracker/schemas/queues/reminder-materialization-trigger.v1.json";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const fallbackCorrelationId = correlationIdFromSqsRecord(record);
    await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const { valid, errors } = defaultSchemaRegistry.validate(TRIGGER_MESSAGE_SCHEMA_ID, parsed);
        if (!valid) {
          logger.error("reminder-materialization-trigger schema-invalid payload", { messageId: record.messageId, errors });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const message = parsed as TriggerMessage;
        await runWithContext({ correlationId: fallbackCorrelationId, tenantId: message.tenantId }, async () => {
          const triggerEvent = parseTriggerEvent(message);
          const result = await handleTriggerEvent(deps, triggerEvent);
          logger.info("reminder-materialization-trigger outcome", { messageId: record.messageId, kind: triggerEvent.kind, result });
        });
      } catch (err) {
        logger.error("reminder-materialization-trigger failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
