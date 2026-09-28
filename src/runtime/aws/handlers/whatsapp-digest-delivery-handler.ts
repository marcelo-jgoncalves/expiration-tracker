/** Real handler for WhatsAppDigestDeliveryWorker (SQS, fed by the shared reminder relay/sweeper's
 * `SQS_NOTIFICATION_WHATSAPP_DIGEST_V1` destination) - D-347 §3.5. Same thin "AWS entrypoint
 * only, pure logic lives elsewhere" shape as `report-subscription-delivery-handler.ts`. Message
 * body is the BARE `WhatsAppDigestFlushRequested.data` payload (`tenantId`/`recipientUserId`/
 * `windowDate`/`items` - no envelope wrapper), same convention `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1`
 * already established - this handler decodes ONLY those four fields, never a wider type.
 *
 * Credentials come from AWS Secrets Manager (same `loadWhatsAppSecrets()` source
 * `whatsapp-delivery-handler.ts` already uses) - fetched once per cold start and memoized. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildWhatsAppDigestDeliveryDeps } from "../composition/notification.js";
import { processWhatsAppDigestDelivery, type WhatsAppDigestDeliverCommand } from "../../../workers/whatsapp-digest-delivery/delivery.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { createSecretsManagerClient, loadWhatsAppSecrets } from "../../../modules/notification/persistence/secrets-manager-whatsapp-config.js";
import { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { AppConfigFeatureFlagsReader } from "../../../modules/extraction/persistence/appconfig-feature-flags-reader.js";
import { isWhatsAppDeliveryWorkerEnabled } from "../../../modules/notification/application/whatsapp-activation.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const whatsAppSecretId = process.env["WHATSAPP_SECRET_ID"];
const whatsAppApiVersion = process.env["WHATSAPP_API_VERSION"] ?? "v21.0";
// D-8: same fail-toward-the-most-restrictive-real-ceiling default as whatsapp-delivery-handler.ts.
const whatsAppPortfolioQuotaTierLimit = Number(process.env["WHATSAPP_PORTFOLIO_QUOTA_TIER_LIMIT"] ?? "250");
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!whatsAppSecretId) throw new Error("WHATSAPP_SECRET_ID env var is required.");
if (!appConfigApplicationId) throw new Error("APPCONFIG_APPLICATION_ID env var is required.");
if (!appConfigEnvironmentId) throw new Error("APPCONFIG_ENVIRONMENT_ID env var is required.");
if (!appConfigConfigurationProfileId) throw new Error("APPCONFIG_CONFIGURATION_PROFILE_ID env var is required.");

const secretsClient = createSecretsManagerClient();
// Round 1 Codex review (D-347 §3.5): the digest path bypassed the SAME kill switch
// (`WHATSAPP_DELIVERY_WORKER_ENABLED`) the immediate WhatsApp send already respects - reused here
// rather than a second, independent flag, since both paths ultimately make the same class of
// external call and an operator disabling WhatsApp delivery means both, not just one.
const featureFlagsReader = new AppConfigFeatureFlagsReader(new AppConfigDataClient({}), {
  applicationId: appConfigApplicationId,
  environmentId: appConfigEnvironmentId,
  configurationProfileId: appConfigConfigurationProfileId,
});

type WhatsAppDigestDeliveryDeps = ReturnType<typeof buildWhatsAppDigestDeliveryDeps>;
let depsPromise: Promise<WhatsAppDigestDeliveryDeps> | undefined;
async function getDeps(): Promise<WhatsAppDigestDeliveryDeps> {
  if (!depsPromise) {
    depsPromise = (async () => {
      const secrets = await loadWhatsAppSecrets(secretsClient, whatsAppSecretId!);
      return buildWhatsAppDigestDeliveryDeps(
        client,
        tableName!,
        { accessToken: secrets.accessToken, phoneNumberId: secrets.phoneNumberId, apiVersion: whatsAppApiVersion },
        whatsAppPortfolioQuotaTierLimit,
      );
    })();
  }
  return depsPromise;
}

const logger = new SecureLogger({ baseContext: { service: "whatsapp-digest-delivery" } });

function isWhatsAppDigestDeliverCommand(message: unknown): message is WhatsAppDigestDeliverCommand {
  const m = message as Partial<WhatsAppDigestDeliverCommand> | undefined;
  return typeof m?.tenantId === "string" && typeof m?.recipientUserId === "string" && typeof m?.windowDate === "string" && Array.isArray(m?.items);
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  // Same fail-closed kill-switch discipline as whatsapp-delivery-handler.ts: checked ONCE per
  // batch, any flags-read error is treated as "disabled" (never "unknown, proceed"). While
  // disabled, every message in this batch is a logged no-op, NEVER a batch item failure - a kill
  // switch being off must never look like a processing error to SQS.
  let deliveryEnabled: boolean;
  try {
    const flags = await featureFlagsReader.getFlags();
    deliveryEnabled = isWhatsAppDeliveryWorkerEnabled(flags);
  } catch (err) {
    logger.error("whatsapp-digest-delivery feature-flags read failed - fail-closed (treating as disabled)", { error: err instanceof Error ? err.message : String(err) });
    deliveryEnabled = false;
  }
  if (!deliveryEnabled) {
    logger.info("whatsapp-digest-delivery kill switch off - batch dropped without side effect", { batchSize: event.Records.length });
    return { batchItemFailures: [] };
  }

  const deps = await getDeps();

  for (const record of event.Records) {
    await runWithContext({ correlationId: record.messageId }, async () => {
      try {
        const raw = JSON.parse(record.body) as unknown;
        if (!isWhatsAppDigestDeliverCommand(raw)) {
          logger.error("whatsapp-digest-delivery malformed message", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const command: WhatsAppDigestDeliverCommand = { tenantId: raw.tenantId, recipientUserId: raw.recipientUserId, windowDate: raw.windowDate, items: raw.items };

        await runWithContext({ correlationId: record.messageId, tenantId: command.tenantId }, async () => {
          const outcome = await processWhatsAppDigestDelivery(deps, command);
          logger.info("whatsapp-digest-delivery outcome", { messageId: record.messageId, recipientUserId: command.recipientUserId, windowDate: command.windowDate, outcome: outcome.kind });
          const needsRedelivery = outcome.kind === "SKIPPED_PORTFOLIO_QUOTA" || (outcome.kind === "SEND_FAILED" && outcome.retryable);
          if (needsRedelivery) {
            batchItemFailures.push({ itemIdentifier: record.messageId });
          }
        });
      } catch (err) {
        logger.error("whatsapp-digest-delivery failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
