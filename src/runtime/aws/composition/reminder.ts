/** Composition root for the reminder module and its async workers against real DynamoDB/SQS (M3.5). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDbReminderStore } from "../../../modules/reminder/persistence/dynamodb-reminder-store.js";
import { DynamoDbReminderProducerStore } from "../../../modules/reminder/persistence/dynamodb-reminder-producer-store.js";
import { DynamoDbReminderReconciliationCandidateSource } from "../../../modules/reminder/persistence/dynamodb-reconciliation-candidate-source.js";
import { DynamoDbOutboxRelayStore } from "../../../shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { ReminderPolicyService } from "../../../modules/reminder/application/reminder-policy-service.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import type { TenantManagerLookup } from "../../../modules/reminder/ports/tenant-manager-lookup.js";
import { organizationKey } from "../../../modules/organization/domain/organization.js";
import { membershipKey, type Membership } from "../../../modules/organization/domain/membership.js";
import { globalUserKey } from "../../../modules/identity/persistence/global-user-repository.js";
import { UlidIdGenerator, newCorrelationId } from "../ids.js";

const MANAGER_ROLES: ReadonlySet<Membership["role"]> = new Set(["OWNER", "ADMIN"]);

/** D-201 (MANAGER escalation): same 2-layer eligibility bar as
 * `expiration.ts`'s `buildMemberEligibilityChecker` (Membership ACTIVE AND GlobalUser
 * identityStatus ACTIVE), extended with a role filter - a "manager" is real RBAC
 * (`OWNER`/`ADMIN`), never a separately configured list. */
export function buildTenantManagerLookup(client: DynamoDBDocumentClient, tableName: string): TenantManagerLookup {
  async function isGlobalUserActive(userId: string): Promise<boolean> {
    const result = await client.send(new GetCommand({ TableName: tableName, Key: globalUserKey(userId), ConsistentRead: true }));
    return (result.Item as { identityStatus?: string } | undefined)?.identityStatus === "ACTIVE";
  }

  return {
    async listActiveManagers(tenantId: string): Promise<{ userId: string }[]> {
      const { PK } = organizationKey(tenantId);
      const result = await client.send(new QueryCommand({ TableName: tableName, ConsistentRead: true, KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)", ExpressionAttributeValues: { ":pk": PK, ":prefix": "MEMBER#" } }));
      const candidates = ((result.Items ?? []) as Membership[]).filter((m) => m.status === "ACTIVE" && MANAGER_ROLES.has(m.role));
      const activeFlags = await Promise.all(candidates.map((m) => isGlobalUserActive(m.userId)));
      return candidates.filter((_, i) => activeFlags[i]).map((m) => ({ userId: m.userId }));
    },
    async isActiveManager(tenantId: string, userId: string): Promise<boolean> {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: membershipKey(tenantId, userId), ConsistentRead: true }));
      const membership = result.Item as Membership | undefined;
      if (membership?.status !== "ACTIVE" || !MANAGER_ROLES.has(membership.role)) return false;
      return isGlobalUserActive(userId);
    },
  };
}

export function buildReminderHttpDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReminderStore(client, tableName);
  const ids = new UlidIdGenerator();
  const policies = new ReminderPolicyService({ store, tableName, ids });
  return { store, policies };
}

export function buildReminderDispatchDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReminderStore(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    tableName,
    managerLookup: buildTenantManagerLookup(client, tableName),
    now: () => new Date().toISOString(),
    newIntentId: () => ids.newIntentId(),
    newEventId: () => ids.newEventId(),
    correlationId: () => newCorrelationId(),
  };
}

export function buildReminderProducerDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReminderProducerStore(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    tableName,
    now: () => new Date().toISOString(),
    newEventId: () => ids.newEventId(),
    correlationId: () => newCorrelationId(),
  };
}

export function buildReconciliationDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReminderStore(client, tableName);
  const candidateSource = new DynamoDbReminderReconciliationCandidateSource(client, tableName);
  return { store, candidateSource, tableName, now: () => new Date().toISOString() };
}

/** BLOCKER-B (reminder-delivery-pipeline.md §4): shard config is fixed/production-current
 * for now, same posture as buildReminderProducerDeps/buildReconciliationDeps - no
 * multi-generation reshard is in flight. */
export function buildReminderMaterializationTriggerDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReminderStore(client, tableName);
  return { store, tableName, now: () => new Date().toISOString(), shardConfig: defaultShardConfig() };
}

/** M10 cluster 4 (D-039/D-046/D-048): `chasingQueueUrl` is optional so this function keeps
 * working for any OTHER caller that only cares about reminder dispatch - passing it adds a
 * SECOND sender to the SAME relay Lambda/DynamoDB Streams event source mapping (mirrors
 * `outbox-sweeper-handler.ts`'s own "one shared privileged role, router keyed by destination"
 * pattern, per m4-notification-engine-design.md §7.4 - never a new relay Lambda just for a
 * second destination). M11 (D-042) adds `importCommitQueueUrl` as a THIRD optional sender on
 * this same shared relay, same reasoning. */
export function buildOutboxRelayDeps(
  client: DynamoDBDocumentClient,
  tableName: string,
  queueUrl: string,
  sqsClient: SQSClient = new SQSClient({}),
  chasingQueueUrl?: string,
  importCommitQueueUrl?: string,
  materializationTriggerQueueUrl?: string,
  // D-192 slice 9: FOURTH optional sender on this same shared relay - `POST /mapping`'s
  // AWAITING_MAPPING->PARSING transition dispatches this destination in the same TWI as the
  // claim (import-service.ts#submitImportMapping). Same "bare event.data, self-contained"
  // payload shape as SQS_IMPORT_COMMIT_V1 (tenantId embedded, no extra envelope wrapping).
  importParseQueueUrl?: string,
  // D-193 item 6/9: FIFTH optional sender - `confirmFieldForDocumentArchive`/`commitRunOutcome`
  // dispatch this destination in the same TWI as `DocumentVersion`'s `validUntil` Update, only
  // when it actually changed. Same bare-event-data shape as SQS_IMPORT_PARSE_V1 above; the
  // payload's `validUntil` is a mere wake-up hint - requirement-evidence-refresh-handler.ts
  // never trusts it, always re-reads DocumentVersion+Requirement fresh.
  requirementEvidenceRefreshQueueUrl?: string,
) {
  const store = new DynamoDbOutboxRelayStore(client, tableName);
  const send = (targetQueueUrl: string) => async (payload: Record<string, unknown>, correlationId: string) => {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: targetQueueUrl,
        MessageBody: JSON.stringify(payload),
        MessageAttributes: { correlationId: { DataType: "String", StringValue: correlationId } },
      }),
    );
  };
  // BLOCKER-B (reminder-delivery-pipeline.md §4): unlike DispatchCommand, this destination's
  // payload is the bare domain event data (matches schemas/events/*.json exactly, no
  // envelope wrapping) - tenantId/eventType aren't embedded in it, so this sender folds them
  // in from the OutboxRecord's own envelope fields before sending, giving the trigger
  // handler a self-contained message it can build a TriggerEvent from without any other
  // context.
  const sendMaterializationTrigger = (targetQueueUrl: string) => async (payload: Record<string, unknown>, correlationId: string, tenantId: string, eventType: string) => {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: targetQueueUrl,
        MessageBody: JSON.stringify({ eventType, tenantId, data: payload }),
        MessageAttributes: { correlationId: { DataType: "String", StringValue: correlationId } },
      }),
    );
  };
  return {
    store,
    now: () => new Date().toISOString(),
    senders: {
      SQS_REMINDER_DISPATCH_V1: send(queueUrl),
      ...(chasingQueueUrl ? { SQS_DOCUMENT_CHASING_DISPATCH_V1: send(chasingQueueUrl) } : {}),
      ...(importCommitQueueUrl ? { SQS_IMPORT_COMMIT_V1: send(importCommitQueueUrl) } : {}),
      ...(importParseQueueUrl ? { SQS_IMPORT_PARSE_V1: send(importParseQueueUrl) } : {}),
      ...(requirementEvidenceRefreshQueueUrl ? { SQS_REQUIREMENT_EVIDENCE_REFRESH_V1: send(requirementEvidenceRefreshQueueUrl) } : {}),
      ...(materializationTriggerQueueUrl ? { SQS_REMINDER_MATERIALIZATION_TRIGGER_V1: sendMaterializationTrigger(materializationTriggerQueueUrl) } : {}),
    },
  };
}
