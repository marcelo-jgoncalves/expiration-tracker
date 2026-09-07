/** Real handler for WhatsAppDeliveryWorker (SQS whatsapp-deliver-queue), fatia 2/5
 * (`whatsapp-channel-scoping/estado-final-consolidado.md`, D-9). Schema-validates against
 * notification-whatsapp-deliver.v1.json before processing - same discipline as
 * email-delivery-handler.ts (schema-invalid payload is a deterministic poison message, still
 * retried/redriven under the uniform native SQS policy - D-128, no branching on retryable).
 *
 * NOT reachable from the real notification flow yet - `notification-router-workflow.ts` never
 * writes a `SQS_NOTIFICATION_WHATSAPP_V1` outbox record (router wiring is fatia 5/5). This
 * handler exists so the queue -> worker -> Cloud API mechanism is deployable and testable ahead
 * of that wiring.
 */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildWhatsAppDeliveryDeps } from "../composition/notification.js";
import { processWhatsAppDelivery, type WhatsAppDeliverCommandData } from "../../../modules/notification/application/whatsapp-delivery-workflow.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
// D-229 fatia 2/5 placeholder credential source (env vars) - fatia 3/5 (Secrets Manager, D-10)
// replaces ONLY these lines with a Secrets Manager read; WhatsAppCloudApiAdapter's shape does
// not change. Empty-string defaults let this Lambda cold-start deploy even before real
// credentials are provisioned; a `send()` call with an empty token fails as a normal
// CONCLUSIVE_TERMINAL (401) rather than crashing the process - acceptable since nothing calls
// this worker via the real flow yet (router wiring is fatia 5/5).
const whatsAppAccessToken = process.env["WHATSAPP_ACCESS_TOKEN"] ?? "";
const whatsAppPhoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "";
const whatsAppApiVersion = process.env["WHATSAPP_API_VERSION"] ?? "v21.0";
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildWhatsAppDeliveryDeps(client, tableName, {
  accessToken: whatsAppAccessToken,
  phoneNumberId: whatsAppPhoneNumberId,
  apiVersion: whatsAppApiVersion,
});
const logger = new SecureLogger({ baseContext: { service: "whatsapp-delivery" } });

const WHATSAPP_DELIVER_SCHEMA_ID = "https://expiration-tracker/schemas/queues/notification-whatsapp-deliver.v1.json";

interface WhatsAppDeliverEnvelope {
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
    const fallbackCorrelationId = correlationIdFromSqsRecord(record);
    await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const { valid, errors } = defaultSchemaRegistry.validate(WHATSAPP_DELIVER_SCHEMA_ID, parsed);
        if (!valid) {
          logger.error("whatsapp-delivery schema-invalid payload", { messageId: record.messageId, errors });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const envelope = parsed as WhatsAppDeliverEnvelope;
        await runWithContext({ correlationId: envelope.correlationId ?? fallbackCorrelationId, tenantId: envelope.tenantId }, async () => {
          try {
            const command: WhatsAppDeliverCommandData = {
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
            const outcome = await processWhatsAppDelivery(deps, command);
            logger.info("whatsapp-delivery outcome", { messageId: record.messageId, attemptId: command.attemptId, outcome: outcome.kind });
            if (outcome.kind === "DEFERRED") {
              return;
            }
          } catch (err) {
            const appErr = toAppError(err);
            logger.error("whatsapp-delivery failed", { messageId: record.messageId, errorCode: appErr.code, retryable: appErr.retryable });
            batchItemFailures.push({ itemIdentifier: record.messageId });
          }
        });
      } catch (err) {
        const appErr = toAppError(err);
        logger.error("whatsapp-delivery failed to parse message body", { messageId: record.messageId, errorCode: appErr.code });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
