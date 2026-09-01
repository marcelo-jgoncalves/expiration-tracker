/** Real handler for DeliveryRecordPurgeWorker (EventBridge Scheduler, daily) — D-152's `createdAt
 * + 180d` physical purge of `NotificationIntent`/`NotificationAttempt` within `ACTIVE` tenants
 * (see `src/workers/delivery-record-purge/purge.ts`'s module doc). Same "top-level `input`,
 * never `event.detail`" contract as `core-user-data-purge-handler.ts`. Wired to real infra
 * (Lambda resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbDeliveryRecordPurgeCandidateSource, DynamoDbTenantLifecycleStatusSource } from "../../../workers/delivery-record-purge/dynamodb-candidate-source.js";
import { runDeliveryRecordPurge } from "../../../workers/delivery-record-purge/purge.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const candidates = new DynamoDbDeliveryRecordPurgeCandidateSource(client, tableName);
const lifecycle = new DynamoDbTenantLifecycleStatusSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "delivery-record-purge" } });

export interface DeliveryRecordPurgeEvent {
  scheduledTime: string;
}

export async function handler(event: DeliveryRecordPurgeEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // core-user-data-purge-handler.ts) — new correlationId per invocation.
  const correlationId = `delivery-record-purge-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handlePurge(event));
}

async function handlePurge(event: DeliveryRecordPurgeEvent): Promise<void> {
  const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("delivery-record-purge complete", { scheduledTime: event.scheduledTime, ...result });
}
