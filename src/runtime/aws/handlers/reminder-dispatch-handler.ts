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
import { toAppError } from "../../../shared/errors/app-error.js";

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
    // m5-observability-design.md #2's general SQS rule: read correlationId from the
    // command's own body (DispatchCommand.correlationId - real fix landed alongside this
    // handler, see producer.ts's DispatchCommand envelope fields), not from
    // MessageAttributes in isolation. This fallback chain only ever affects LOG CONTEXT,
    // never whether a message is processed: a schema-invalid message (including any
    // in-flight message from before this fix, which lacked `correlationId` entirely) is
    // always rejected as a poison message below, regardless of which correlationId source
    // is available. The chain just decides what correlationId that rejection's own log line
    // carries - MessageAttributes (still set by the relay/sweeper, sourced from the exact
    // same outbox event as the body) before falling back to the SQS messageId.
    const fallbackCorrelationId = correlationIdFromSqsRecord(record);
    await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
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
        // m5-observability-design.md #2: nest the command's own correlationId + tenantId
        // once known, without mutating the outer per-record context (AsyncLocalStorage.run
        // composition).
        await runWithContext({ correlationId: command.correlationId ?? fallbackCorrelationId, tenantId: command.tenantId }, async () => {
          const outcome = await dispatchOccurrence(deps, command);
          logger.info("reminder-dispatch outcome", { messageId: record.messageId, outcome: outcome.kind });
        });
      } catch (err) {
        // errorCode/retryable logged for consistency with every other handler's pattern (e.g.
        // textract-task-handler.ts) - see app-error.ts's isRetryable() doc comment for the
        // honest, current scope of what `retryable` actually drives today (this handler still
        // always reports a batch item failure regardless of the value - SQS's own
        // maxReceiveCount+DLQ is the real terminal decision, not this field; logged here for
        // diagnosis, not branching).
        const appErr = toAppError(err);
        logger.error("reminder-dispatch failed", { messageId: record.messageId, errorCode: appErr.code, retryable: appErr.retryable });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
