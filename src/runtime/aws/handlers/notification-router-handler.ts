/** Real handler for NotificationRouter (DynamoDB Streams NEW_IMAGE on NotificationIntent
 * rows), M4. Partial batch failure, same discipline as dispatch-outbox-relay-handler.ts -
 * only genuinely retryable outcomes (RouterWorkflowOutcome "RETRY") are reported back as
 * failures; NOOP/CANCELLED/STALE/ROUTED are all successful terminal outcomes for this
 * Streams record, never retried. */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildNotificationRouterDeps } from "../composition/notification.js";
import { routeNotificationIntent, type NotificationRouterWorkflowDeps } from "../../../modules/notification/application/notification-router-workflow.js";
import type { NotificationIntent } from "../../../modules/reminder/domain/notification-intent.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { AppConfigFeatureFlagsReader } from "../../../modules/extraction/persistence/appconfig-feature-flags-reader.js";
import { isWhatsAppChannelEnabled } from "../../../modules/notification/application/whatsapp-activation.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!appConfigApplicationId) throw new Error("APPCONFIG_APPLICATION_ID env var is required.");
if (!appConfigEnvironmentId) throw new Error("APPCONFIG_ENVIRONMENT_ID env var is required.");
if (!appConfigConfigurationProfileId) throw new Error("APPCONFIG_CONFIGURATION_PROFILE_ID env var is required.");

const featureFlagsReader = new AppConfigFeatureFlagsReader(new AppConfigDataClient({}), {
  applicationId: appConfigApplicationId,
  environmentId: appConfigEnvironmentId,
  configurationProfileId: appConfigConfigurationProfileId,
});
const logger = new SecureLogger({ baseContext: { service: "notification-router" } });

async function processRecord(
  deps: NotificationRouterWorkflowDeps,
  record: import("aws-lambda").DynamoDBRecord,
  item: Record<string, unknown> & { entityType?: string; tenantId?: string },
  batchItemFailures: { itemIdentifier: string }[],
): Promise<void> {
  // m5-observability-design.md #2: NotificationIntent doesn't carry a correlationId
  // field - fall back to the Streams record's own SequenceNumber, same fallback the
  // design prescribes for DynamoDB Streams sources without one.
  const correlationId = record.dynamodb?.SequenceNumber ?? record.eventID ?? "unknown";
  await runWithContext({ correlationId, tenantId: item.tenantId }, async () => {
    // try/catch stays INSIDE runWithContext - see dispatch-outbox-relay-handler.ts's comment
    // on why a catch wrapping runWithContext itself would lose the record's correlationId.
    try {
      const outcome = await routeNotificationIntent(deps, item as unknown as NotificationIntent);
      logger.info("notification-router outcome", { intentId: item["intentId"], outcome: outcome.kind });
      if (outcome.kind === "RETRY") {
        batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
      }
    } catch (err) {
      logger.error("notification-router failed", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
    }
  });
}

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  // D-197 fatia 5/5: `WHATSAPP` kill switch read ONCE per batch, fail-closed - same discipline
  // `whatsapp-delivery-handler.ts` already uses (any flags-read error is treated as "disabled",
  // never "unknown, proceed"). Unlike the delivery worker, a disabled channel here never drops
  // the whole batch - EMAIL-only intents route exactly as before; only WHATSAPP-requesting
  // intents fall back to CHANNEL_UNAVAILABLE per `notification-router.ts`'s own per-channel gate.
  const whatsappChannelEnabled = await (async () => {
    try {
      const flags = await featureFlagsReader.getFlags();
      return isWhatsAppChannelEnabled(flags);
    } catch (err) {
      logger.error("notification-router feature-flags read failed - fail-closed (treating WHATSAPP as disabled)", { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  })();
  const deps = buildNotificationRouterDeps(client, tableName!, whatsappChannelEnabled);

  for (const record of event.Records) {
    if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") continue;
    const image = record.dynamodb?.NewImage;
    if (!image) continue;

    try {
      const item = unmarshall(image as Record<string, never>) as Record<string, unknown> & { entityType?: string; tenantId?: string };
      if (item["entityType"] !== "NotificationIntent") continue;
      await processRecord(deps, record, item, batchItemFailures);
    } catch (err) {
      logger.error("notification-router failed to parse Streams image", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
    }
  }

  return { batchItemFailures };
}
