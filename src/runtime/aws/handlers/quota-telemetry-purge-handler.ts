/** Real handler for QuotaTelemetryPurgeWorker (EventBridge Scheduler, daily) — D-154's `resetAt +
 * 30d` physical purge of `TenantQuotaRecord` rows within `ACTIVE` tenants (see
 * `src/workers/quota-telemetry-purge/purge.ts`'s module doc). Same "top-level `input`, never
 * `event.detail`" contract as `security-audit-purge-handler.ts`. Wired to real infra (Lambda
 * resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbQuotaTelemetryPurgeCandidateSource, DynamoDbTenantLifecycleStatusSource } from "../../../workers/quota-telemetry-purge/dynamodb-candidate-source.js";
import { runQuotaTelemetryPurge } from "../../../workers/quota-telemetry-purge/purge.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const candidates = new DynamoDbQuotaTelemetryPurgeCandidateSource(client, tableName);
const lifecycle = new DynamoDbTenantLifecycleStatusSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "quota-telemetry-purge" } });

export interface QuotaTelemetryPurgeEvent {
  scheduledTime: string;
}

export async function handler(event: QuotaTelemetryPurgeEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // security-audit-purge-handler.ts) — new correlationId per invocation.
  const correlationId = `quota-telemetry-purge-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handlePurge(event));
}

async function handlePurge(event: QuotaTelemetryPurgeEvent): Promise<void> {
  const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("quota-telemetry-purge complete", { scheduledTime: event.scheduledTime, ...result });
}
