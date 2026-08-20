/** Real handler for NotificationRouter (DynamoDB Streams NEW_IMAGE on NotificationIntent
 * rows), M4. Partial batch failure, same discipline as dispatch-outbox-relay-handler.ts -
 * only genuinely retryable outcomes (RouterWorkflowOutcome "RETRY") are reported back as
 * failures; NOOP/CANCELLED/STALE/ROUTED are all successful terminal outcomes for this
 * Streams record, never retried. */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildNotificationRouterDeps } from "../composition/notification.js";
import { routeNotificationIntent } from "../../../modules/notification/application/notification-router-workflow.js";
import type { NotificationIntent } from "../../../modules/reminder/domain/notification-intent.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildNotificationRouterDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "notification-router" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") continue;
    const image = record.dynamodb?.NewImage;
    if (!image) continue;

    try {
      const item = unmarshall(image as Record<string, never>) as Record<string, unknown> & { entityType?: string };
      if (item["entityType"] !== "NotificationIntent") continue;

      const outcome = await routeNotificationIntent(deps, item as unknown as NotificationIntent);
      logger.info("notification-router outcome", { intentId: item["intentId"], outcome: outcome.kind });
      if (outcome.kind === "RETRY") {
        batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
      }
    } catch (err) {
      logger.error("notification-router failed", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
    }
  }

  return { batchItemFailures };
}
