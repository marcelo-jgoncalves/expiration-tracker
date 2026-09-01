/** Real handler for InvitationPurgeWorker (EventBridge Scheduler, daily) — D-155's terminal-state
 * (`REVOKED`/expired-`PENDING`) `+ 30d` physical purge of `Invitation` rows within `ACTIVE`
 * tenants (see `src/workers/invitation-purge/purge.ts`'s module doc). Same "top-level `input`,
 * never `event.detail`" contract as `quota-telemetry-purge-handler.ts`. Wired to real infra
 * (Lambda resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbInvitationPurgeCandidateSource, DynamoDbTenantLifecycleStatusSource } from "../../../workers/invitation-purge/dynamodb-candidate-source.js";
import { runInvitationPurge } from "../../../workers/invitation-purge/purge.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const candidates = new DynamoDbInvitationPurgeCandidateSource(client, tableName);
const lifecycle = new DynamoDbTenantLifecycleStatusSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "invitation-purge" } });

export interface InvitationPurgeEvent {
  scheduledTime: string;
}

export async function handler(event: InvitationPurgeEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // quota-telemetry-purge-handler.ts) — new correlationId per invocation.
  const correlationId = `invitation-purge-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handlePurge(event));
}

async function handlePurge(event: InvitationPurgeEvent): Promise<void> {
  const result = await runInvitationPurge({ candidates, lifecycle, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("invitation-purge complete", { scheduledTime: event.scheduledTime, ...result });
}
