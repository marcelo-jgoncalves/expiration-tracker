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
import { mapWithConcurrency } from "../../../shared/concurrency/map-with-concurrency.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildReminderDispatchDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-dispatch" } });

// Contract source of truth for this queue payload: schemas/queues/reminder-dispatch.v1.json
// (audit round1/qualidade finding: a schema already existed but no runtime handler ever
// validated against it - JSON.parse(...) as DispatchCommand was a silent, unchecked cast).
const DISPATCH_COMMAND_SCHEMA_ID = "https://expiration-tracker/schemas/queues/reminder-dispatch.v1.json";

// D-170: batch items are independent occurrences (different tenants/items in the general
// case) - processing them one at a time serialized every message's DynamoDB round trips
// behind the previous message's, even though nothing here needs that ordering. Bounded
// rather than unbounded parallelism to keep the burst of DynamoDB/SQS calls per Lambda
// invocation predictable (batch size is already capped at 10 by the queue config, this just
// avoids adding a 4th unbounded fan-out on top).
const BATCH_CONCURRENCY = 5;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const results = await mapWithConcurrency(event.Records, BATCH_CONCURRENCY, async (record) => {
    await processRecord(record);
  });

  // mapWithConcurrency never throws per-item - each record's own failure is captured in its
  // own result slot, so a slow/failing message never causes an unrelated, already-succeeded
  // message in the same batch to be reported as failed (or vice versa: swallowed silently).
  const batchItemFailures: { itemIdentifier: string }[] = [];
  results.forEach((result, i) => {
    if (!result.ok) batchItemFailures.push({ itemIdentifier: event.Records[i]!.messageId });
  });
  return { batchItemFailures };
}

// D-170: extracted so `handler` can run this per-record body under mapWithConcurrency -
// failure is now signaled by throwing (mapWithConcurrency captures it into that record's own
// result slot) instead of pushing into a shared `batchItemFailures` array, which would have
// been a data race under concurrent execution.
async function processRecord(record: SQSEvent["Records"][number]): Promise<void> {
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
    // `schemaInvalid` distinguishes the two failure branches below so each is logged exactly
    // once - the schema-invalid branch already logs its own specific reason before throwing;
    // re-logging it as a generic toAppError "reminder-dispatch failed" line in the catch
    // would duplicate the same event under two different messages.
    let schemaInvalid = false;
    try {
      const parsed: unknown = JSON.parse(record.body);
      const { valid, errors } = defaultSchemaRegistry.validate(DISPATCH_COMMAND_SCHEMA_ID, parsed);
      if (!valid) {
        // Deterministic poison message - will fail identically on redelivery - but still
        // reported as a batch item failure and retried up to maxReceiveCount like any other
        // failure, redriven under the uniform native SQS policy (D-128: no handler in this
        // codebase branches on retryable/poison classification; m3.5-runtime-design.md §10).
        schemaInvalid = true;
        logger.error("reminder-dispatch schema-invalid payload", { messageId: record.messageId, errors });
        throw new Error("schema-invalid payload");
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
      if (!schemaInvalid) {
        // errorCode/retryable logged for consistency with every other handler's pattern (e.g.
        // textract-task-handler.ts) - D-128 decided no handler branches on this value; it is
        // diagnostic metadata only (see app-error.ts's isRetryable() doc comment).
        const appErr = toAppError(err);
        logger.error("reminder-dispatch failed", { messageId: record.messageId, errorCode: appErr.code, retryable: appErr.retryable });
      }
      throw err;
    }
  });
}
