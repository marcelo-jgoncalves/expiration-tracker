/** Real handler for MembershipPurgeWorker (EventBridge Scheduler, daily) — D-127 Prioridade 5's
 * `REMOVED` + 30d physical purge of `Membership` rows within `ACTIVE` tenants (see
 * `src/workers/membership-purge/purge.ts`'s module doc). Same "top-level `input`, never
 * `event.detail`" contract as the other purge handlers. Wired to real infra (Lambda resource +
 * EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbMembershipPurgeCandidateSource, DynamoDbTenantLifecycleStatusSource } from "../../../workers/membership-purge/dynamodb-candidate-source.js";
import { runMembershipPurge } from "../../../workers/membership-purge/purge.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const candidates = new DynamoDbMembershipPurgeCandidateSource(client, tableName);
const lifecycle = new DynamoDbTenantLifecycleStatusSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "membership-purge" } });

export interface MembershipPurgeEvent {
  scheduledTime: string;
}

export async function handler(event: MembershipPurgeEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // the other purge handlers) — new correlationId per invocation.
  const correlationId = `membership-purge-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handlePurge(event));
}

async function handlePurge(event: MembershipPurgeEvent): Promise<void> {
  const result = await runMembershipPurge({ candidates, lifecycle, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("membership-purge complete", { scheduledTime: event.scheduledTime, ...result });
}
