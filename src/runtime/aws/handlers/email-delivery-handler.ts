/** Real handler for EmailDeliveryWorker (SQS EmailDeliverQueue), M4. Schema-validates
 * against notification-email-deliver.v1.json before processing - same discipline as
 * reminder-dispatch-handler.ts (schema-invalid payload is a deterministic poison message, still
 * retried/redriven under the uniform native SQS policy - D-128, no branching on retryable). */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildEmailDeliveryDeps } from "../composition/notification.js";
import { processEmailDelivery, type EmailDeliverCommandData } from "../../../modules/notification/application/email-delivery-workflow.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const sesFromAddress = process.env["SES_FROM_ADDRESS"];
const sesConfigurationSet = process.env["SES_CONFIGURATION_SET"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!sesFromAddress) throw new Error("SES_FROM_ADDRESS env var is required.");
if (!sesConfigurationSet) throw new Error("SES_CONFIGURATION_SET env var is required.");
const deps = buildEmailDeliveryDeps(client, tableName, sesFromAddress, sesConfigurationSet);
const logger = new SecureLogger({ baseContext: { service: "email-delivery" } });

const EMAIL_DELIVER_SCHEMA_ID = "https://expiration-tracker/schemas/queues/notification-email-deliver.v1.json";

interface EmailDeliverEnvelope {
  tenantId: string;
  correlationId: string;
  data: {
    intentId: string;
    attemptId: string;
    itemId: string;
    expectedItemVersion: number;
    templateId: string;
    templateVersion: number;
    locale: string;
    deliverNotBefore: string;
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    // Logging-observability-standard.md "Propagação de correlação" (2026-08-29 audit finding):
    // the JSON.parse/schema-validation failure paths below used to log with NO correlationId
    // at all (outside any runWithContext), unlike reminder-dispatch-handler.ts's established
    // pattern of an outer, SQS-derived fallback correlationId covering the whole per-record
    // body - a malformed/schema-invalid message's own failure log was unjoinable to anything.
    // Mirrors that same pattern here.
    const fallbackCorrelationId = correlationIdFromSqsRecord(record);
    await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const { valid, errors } = defaultSchemaRegistry.validate(EMAIL_DELIVER_SCHEMA_ID, parsed);
        if (!valid) {
          logger.error("email-delivery schema-invalid payload", { messageId: record.messageId, errors });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const envelope = parsed as EmailDeliverEnvelope;
        await runWithContext({ correlationId: envelope.correlationId ?? fallbackCorrelationId, tenantId: envelope.tenantId }, async () => {
          // try/catch stays INSIDE runWithContext - see dispatch-outbox-relay-handler.ts's
          // comment on why a catch wrapping runWithContext itself would lose this record's
          // correlationId/tenantId (AsyncLocalStorage.run already restored the outer/empty
          // context by the time a catch outside it runs).
          try {
            const command: EmailDeliverCommandData = {
              tenantId: envelope.tenantId,
              intentId: envelope.data.intentId,
              attemptId: envelope.data.attemptId,
              itemId: envelope.data.itemId,
              expectedItemVersion: envelope.data.expectedItemVersion,
              templateId: envelope.data.templateId,
              templateVersion: envelope.data.templateVersion,
              locale: envelope.data.locale,
              deliverNotBefore: envelope.data.deliverNotBefore,
              correlationId: envelope.correlationId,
            };
            const outcome = await processEmailDelivery(deps, command);
            logger.info("email-delivery outcome", { messageId: record.messageId, attemptId: command.attemptId, outcome: outcome.kind });
            if (outcome.kind === "DEFERRED") {
              // Quiet hours not over yet - never discard. The router already scheduled a
              // one-shot EventBridge Scheduler re-delivery (design §5.3); reporting THIS
              // delivery as a batch item failure would just requeue it needlessly before that
              // fires. No action needed here beyond the log above.
              return;
            }
          } catch (err) {
            // errorCode/retryable logged for consistency with every other handler's pattern
            // (e.g. textract-task-handler.ts) - D-128 decided no handler branches on this
            // value; it is diagnostic metadata only (see app-error.ts's isRetryable() doc
            // comment).
            const appErr = toAppError(err);
            logger.error("email-delivery failed", { messageId: record.messageId, errorCode: appErr.code, retryable: appErr.retryable });
            batchItemFailures.push({ itemIdentifier: record.messageId });
          }
        });
      } catch (err) {
        // JSON.parse itself threw on a malformed body - no envelope available, but the
        // fallback correlationId above still applies.
        const appErr = toAppError(err);
        logger.error("email-delivery failed to parse message body", { messageId: record.messageId, errorCode: appErr.code });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
