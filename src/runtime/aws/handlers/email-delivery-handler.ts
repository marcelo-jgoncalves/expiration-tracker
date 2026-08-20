/** Real handler for EmailDeliveryWorker (SQS EmailDeliverQueue), M4. Schema-validates
 * against notification-email-deliver.v1.json before processing - same discipline as
 * reminder-dispatch-handler.ts (schema-invalid payload is a poison message, not retryable). */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildEmailDeliveryDeps } from "../composition/notification.js";
import { processEmailDelivery, type EmailDeliverCommandData } from "../../../modules/notification/application/email-delivery-workflow.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";

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
    try {
      const parsed: unknown = JSON.parse(record.body);
      const { valid, errors } = defaultSchemaRegistry.validate(EMAIL_DELIVER_SCHEMA_ID, parsed);
      if (!valid) {
        logger.error("email-delivery schema-invalid payload", { messageId: record.messageId, errors });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      const envelope = parsed as EmailDeliverEnvelope;
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
        // one-shot EventBridge Scheduler re-delivery (design §5.3); reporting THIS delivery
        // as a batch item failure would just requeue it needlessly before that fires. No
        // action needed here beyond the log above.
        continue;
      }
    } catch (err) {
      logger.error("email-delivery failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
