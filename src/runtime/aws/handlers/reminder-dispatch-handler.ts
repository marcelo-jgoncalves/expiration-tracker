/** Real handler for ReminderDispatch (SQS ReminderDispatchQueue), replacing the 501
 * placeholder. Partial batch failure (m3.5-runtime-design.md §"SQS + DLQ"): only failed
 * items are reported back, successful/duplicate/already-resolved items in the same batch
 * are never retried. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderDispatchDeps } from "../composition/reminder.js";
import { dispatchOccurrence } from "../../../workers/reminder-dispatch/dispatch.js";
import type { DispatchCommand } from "../../../workers/reminder-producer/producer.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildReminderDispatchDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-dispatch" } });

// Contract source of truth for this queue payload: schemas/queues/reminder-dispatch.v1.json
// (audit round1/qualidade finding: a schema already existed but no runtime handler ever
// validated against it - JSON.parse(...) as DispatchCommand was a silent, unchecked cast).
const DISPATCH_COMMAND_SCHEMA_ID = "https://expiration-tracker/schemas/queues/reminder-dispatch.v1.json";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    // m5-observability-design.md #2: DispatchCommand's own JSON body doesn't carry a
    // correlationId field, but the relay/sweeper (dispatch-outbox-relay-handler ->
    // composition/reminder.ts) already propagates the ORIGINAL correlationId via this SQS
    // message's own MessageAttributes - reading it here is what actually closes the
    // outbox -> SQS -> Lambda causality chain the milestone exists for. Fall back to the
    // SQS messageId only for a message that never got that attribute (pre-M5 in-flight).
    const correlationId = correlationIdFromSqsRecord(record);
    await runWithContext({ correlationId }, async () => {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const { valid, errors } = defaultSchemaRegistry.validate(DISPATCH_COMMAND_SCHEMA_ID, parsed);
        if (!valid) {
          // Schema-invalid payload is treated as a poison message, not a retryable failure -
          // it can never become valid on retry. Still reported as a batch item failure so
          // SQS's own maxReceiveCount+DLQ (not this handler) is what stops the retries
          // (m3.5-runtime-design.md §10 "Poison message").
          logger.error("reminder-dispatch schema-invalid payload", { messageId: record.messageId, errors });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const command = parsed as DispatchCommand;
        // m5-observability-design.md #2: nest tenantId once known from the command, without
        // mutating the outer per-record context (AsyncLocalStorage.run composition).
        await runWithContext({ correlationId, tenantId: command.tenantId }, async () => {
          const outcome = await dispatchOccurrence(deps, command);
          logger.info("reminder-dispatch outcome", { messageId: record.messageId, outcome: outcome.kind });
        });
      } catch (err) {
        logger.error("reminder-dispatch failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
