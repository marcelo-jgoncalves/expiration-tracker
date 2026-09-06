/** Real handler for ReportSubscriptionDeliveryWorker (SQS, fed by DispatchOutboxRelay/
 * OutboxSweeper's `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1` destination) - D-204 fatia 3. Same thin
 * "AWS entrypoint only, pure logic lives elsewhere" shape as
 * `requirement-evidence-refresh-handler.ts`. Message body is the BARE
 * `ReportSubscriptionRunRequested.data` payload (`runId`/`subscriptionId`/`tenantId`/
 * `scheduledFor` - no envelope wrapper), same convention `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`
 * already established - this handler decodes ONLY those four fields, never a wider type. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReportSubscriptionDeliveryDeps } from "../composition/reports.js";
import { processReportSubscriptionDelivery, type ReportSubscriptionDeliveryCommand } from "../../../workers/report-subscription-delivery/delivery.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const reportExportsBucketName = process.env["REPORT_EXPORTS_BUCKET_NAME"];
const sesFromAddress = process.env["SES_FROM_ADDRESS"];
const sesConfigurationSet = process.env["SES_CONFIGURATION_SET"];
const apiBaseUrl = process.env["API_BASE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!reportExportsBucketName) throw new Error("REPORT_EXPORTS_BUCKET_NAME env var is required.");
if (!sesFromAddress) throw new Error("SES_FROM_ADDRESS env var is required.");
if (!sesConfigurationSet) throw new Error("SES_CONFIGURATION_SET env var is required.");
if (!apiBaseUrl) throw new Error("API_BASE_URL env var is required.");
const deps = buildReportSubscriptionDeliveryDeps(client, tableName, reportExportsBucketName, sesFromAddress, sesConfigurationSet, apiBaseUrl);
const logger = new SecureLogger({ baseContext: { service: "report-subscription-delivery" } });

function isReportSubscriptionDeliveryCommand(message: unknown): message is ReportSubscriptionDeliveryCommand {
  const m = message as Partial<ReportSubscriptionDeliveryCommand> | undefined;
  return typeof m?.tenantId === "string" && typeof m?.subscriptionId === "string" && typeof m?.runId === "string" && typeof m?.scheduledFor === "string";
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    await runWithContext({ correlationId: randomUUID() }, async () => {
      try {
        const raw = JSON.parse(record.body) as unknown;
        if (!isReportSubscriptionDeliveryCommand(raw)) {
          logger.error("report-subscription-delivery malformed message", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const command: ReportSubscriptionDeliveryCommand = { tenantId: raw.tenantId, subscriptionId: raw.subscriptionId, runId: raw.runId, scheduledFor: raw.scheduledFor };

        await runWithContext({ correlationId: randomUUID(), tenantId: command.tenantId }, async () => {
          const result = await processReportSubscriptionDelivery(deps, command);
          logger.info("report-subscription-delivery outcome", { messageId: record.messageId, subscriptionId: command.subscriptionId, runId: command.runId, ...result });
          // A per-recipient send failure never aborts the others (delivery.ts's own isolation
          // discipline) - but if the run/subscription itself was gone (nothing to freeze/
          // deliver) or ANY recipient's outcome was a real failure (never merely "ineligible" or
          // "already resolved", both expected terminal states), report the message itself
          // failed so SQS's native redrive/DLQ policy retries this wake-up.
          if (result.kind === "PROCESSED" && result.recipients.some((r) => r.outcome === "SEND_FAILED")) {
            batchItemFailures.push({ itemIdentifier: record.messageId });
          }
        });
      } catch (err) {
        logger.error("report-subscription-delivery failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
