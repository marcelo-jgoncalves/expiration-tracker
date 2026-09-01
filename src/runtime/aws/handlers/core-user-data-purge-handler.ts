/** Real handler for CoreUserDataPurgeWorker (EventBridge Scheduler, daily) — D-151's `deletedAt
 * + 30d` physical purge of `ExpirationItem`/`ReminderPolicy` within `ACTIVE` tenants (see
 * `src/workers/core-user-data-purge/purge.ts`'s module doc). Same "top-level `input`, never
 * `event.detail`" contract as `requirement-reindex-handler.ts`. Wired to real infra (Lambda
 * resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbCoreUserDataPurgeCandidateSource, DynamoDbTenantLifecycleStatusSource } from "../../../workers/core-user-data-purge/dynamodb-candidate-source.js";
import { runCoreUserDataPurge } from "../../../workers/core-user-data-purge/purge.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const candidates = new DynamoDbCoreUserDataPurgeCandidateSource(client, tableName);
const lifecycle = new DynamoDbTenantLifecycleStatusSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "core-user-data-purge" } });

export interface CoreUserDataPurgeEvent {
  scheduledTime: string;
}

export async function handler(event: CoreUserDataPurgeEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // requirement-reindex-handler.ts) — new correlationId per invocation.
  const correlationId = `core-user-data-purge-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handlePurge(event));
}

async function handlePurge(event: CoreUserDataPurgeEvent): Promise<void> {
  const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("core-user-data-purge complete", { scheduledTime: event.scheduledTime, ...result });
}
