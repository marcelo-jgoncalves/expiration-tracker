/** Real handler for TransientPurgeWorker (EventBridge Scheduler, daily) — D-156's `WebhookInbox`
 * (`createdAt+7d`) and `UploadSlot` (`reservedAt+7d` confirmed / `+24h` incomplete) physical purge
 * within `ACTIVE` tenants (see `src/workers/transient-purge/purge.ts`'s module doc). Same
 * "top-level `input`, never `event.detail`" contract as the other purge handlers. Wired to real
 * infra (Lambda resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbTransientPurgeCandidateSource, DynamoDbTenantLifecycleStatusSource } from "../../../workers/transient-purge/dynamodb-candidate-source.js";
import { runTransientPurge } from "../../../workers/transient-purge/purge.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const candidates = new DynamoDbTransientPurgeCandidateSource(client, tableName);
const lifecycle = new DynamoDbTenantLifecycleStatusSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "transient-purge" } });

export interface TransientPurgeEvent {
  scheduledTime: string;
}

export async function handler(event: TransientPurgeEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // the other purge handlers) — new correlationId per invocation.
  const correlationId = `transient-purge-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handlePurge(event));
}

async function handlePurge(event: TransientPurgeEvent): Promise<void> {
  const result = await runTransientPurge({ candidates, lifecycle, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("transient-purge complete", { scheduledTime: event.scheduledTime, ...result });
}
