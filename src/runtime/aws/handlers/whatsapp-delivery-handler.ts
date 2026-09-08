/** Real handler for WhatsAppDeliveryWorker (SQS whatsapp-deliver-queue), fatia 2/5
 * (`whatsapp-channel-scoping/estado-final-consolidado.md`, D-9) + fatia 3/5 (D-10 Secrets
 * Manager, kill switch). Schema-validates against notification-whatsapp-deliver.v1.json before
 * processing - same discipline as email-delivery-handler.ts (schema-invalid payload is a
 * deterministic poison message, still retried/redriven under the uniform native SQS policy -
 * D-128, no branching on retryable).
 *
 * NOT reachable from the real notification flow yet - `notification-router-workflow.ts` never
 * writes a `SQS_NOTIFICATION_WHATSAPP_V1` outbox record (router wiring is fatia 5/5). This
 * handler exists so the queue -> worker -> Cloud API mechanism is deployable and testable ahead
 * of that wiring.
 *
 * Credentials now come from AWS Secrets Manager (D-10, fatia 3/5) - `whatsapp-cloud-api-
 * adapter.ts`'s `WhatsAppCloudApiConfig` shape is UNCHANGED, exactly as fatia 2/5's own comment
 * promised; only the SOURCE changed (env vars -> `loadWhatsAppSecrets()`). Fetched once per cold
 * start and memoized (module-level promise) - Lambda execution environments are reused across
 * invocations, so this is one `GetSecretValue` call per cold start, not per message.
 */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildWhatsAppDeliveryDeps } from "../composition/notification.js";
import { processWhatsAppDelivery, type WhatsAppDeliverCommandData } from "../../../modules/notification/application/whatsapp-delivery-workflow.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { toAppError } from "../../../shared/errors/app-error.js";
import { createSecretsManagerClient, loadWhatsAppSecrets } from "../../../modules/notification/persistence/secrets-manager-whatsapp-config.js";
import { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { AppConfigFeatureFlagsReader } from "../../../modules/extraction/persistence/appconfig-feature-flags-reader.js";
import { isWhatsAppDeliveryWorkerEnabled } from "../../../modules/notification/application/whatsapp-activation.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const whatsAppSecretId = process.env["WHATSAPP_SECRET_ID"];
const whatsAppApiVersion = process.env["WHATSAPP_API_VERSION"] ?? "v21.0";
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!whatsAppSecretId) throw new Error("WHATSAPP_SECRET_ID env var is required.");
if (!appConfigApplicationId) throw new Error("APPCONFIG_APPLICATION_ID env var is required.");
if (!appConfigEnvironmentId) throw new Error("APPCONFIG_ENVIRONMENT_ID env var is required.");
if (!appConfigConfigurationProfileId) throw new Error("APPCONFIG_CONFIGURATION_PROFILE_ID env var is required.");

const secretsClient = createSecretsManagerClient();
const featureFlagsReader = new AppConfigFeatureFlagsReader(new AppConfigDataClient({}), {
  applicationId: appConfigApplicationId,
  environmentId: appConfigEnvironmentId,
  configurationProfileId: appConfigConfigurationProfileId,
});

type WhatsAppDeliveryDeps = ReturnType<typeof buildWhatsAppDeliveryDeps>;
let depsPromise: Promise<WhatsAppDeliveryDeps> | undefined;
async function getDeps(): Promise<WhatsAppDeliveryDeps> {
  if (!depsPromise) {
    depsPromise = (async () => {
      const secrets = await loadWhatsAppSecrets(secretsClient, whatsAppSecretId!);
      return buildWhatsAppDeliveryDeps(client, tableName!, {
        accessToken: secrets.accessToken,
        phoneNumberId: secrets.phoneNumberId,
        apiVersion: whatsAppApiVersion,
      });
    })();
  }
  return depsPromise;
}

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

  // D-197 fatia 3/5 (D-10) kill switch - checked ONCE per batch, fail-closed: any flags-read
  // error is treated as "disabled" (never "unknown, proceed"), same discipline
  // `document-archive-activation.ts`'s own callers use. While disabled, every message in this
  // batch is a logged no-op, NEVER marked as a batch item failure - a kill switch being off must
  // never look like a processing error to SQS (that would drive redrive-policy retries/DLQ
  // routing for messages that are working exactly as intended).
  let deliveryEnabled: boolean;
  try {
    const flags = await featureFlagsReader.getFlags();
    deliveryEnabled = isWhatsAppDeliveryWorkerEnabled(flags);
  } catch (err) {
    logger.error("whatsapp-delivery feature-flags read failed - fail-closed (treating as disabled)", { error: err instanceof Error ? err.message : String(err) });
    deliveryEnabled = false;
  }
  if (!deliveryEnabled) {
    logger.info("whatsapp-delivery kill switch off - batch dropped without side effect", { batchSize: event.Records.length });
    return { batchItemFailures: [] };
  }

  const deps = await getDeps();

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
