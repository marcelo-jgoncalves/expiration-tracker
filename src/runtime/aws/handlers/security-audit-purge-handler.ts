/** Real handler for SecurityAuditPurgeWorker (EventBridge Scheduler, daily) — D-153's `occurredAt
 * + 365d` physical purge of the 4 `AuditEvent`-family rows within `ACTIVE` tenants (see
 * `src/workers/security-audit-purge/purge.ts`'s module doc). Same "top-level `input`, never
 * `event.detail`" contract as `delivery-record-purge-handler.ts`. Wired to real infra (Lambda
 * resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbSecurityAuditPurgeCandidateSource, DynamoDbTenantLifecycleStatusSource } from "../../../workers/security-audit-purge/dynamodb-candidate-source.js";
import { runSecurityAuditPurge } from "../../../workers/security-audit-purge/purge.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const candidates = new DynamoDbSecurityAuditPurgeCandidateSource(client, tableName);
const lifecycle = new DynamoDbTenantLifecycleStatusSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "security-audit-purge" } });

export interface SecurityAuditPurgeEvent {
  scheduledTime: string;
}

export async function handler(event: SecurityAuditPurgeEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // delivery-record-purge-handler.ts) — new correlationId per invocation.
  const correlationId = `security-audit-purge-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handlePurge(event));
}

async function handlePurge(event: SecurityAuditPurgeEvent): Promise<void> {
  const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("security-audit-purge complete", { scheduledTime: event.scheduledTime, ...result });
}
