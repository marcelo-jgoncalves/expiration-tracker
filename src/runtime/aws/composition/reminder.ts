/** Composition root for the reminder module and its async workers against real DynamoDB/SQS (M3.5). */
import { randomUUID } from "node:crypto";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import type { ClaimCandidateCommand, ClaimQueuePort, SendMessageBatchOutcome } from "../../../workers/reminder-scan/scan-page.js";
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
import { authorizedTenantIdFromPersistedEntity } from "../../../modules/identity/domain/authorization.js";
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
      const { PK } = organizationKey(authorizedTenantIdFromPersistedEntity({ tenantId }));
      const result = await client.send(new QueryCommand({ TableName: tableName, ConsistentRead: true, KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)", ExpressionAttributeValues: { ":pk": PK, ":prefix": "MEMBER#" } }));
      const candidates = ((result.Items ?? []) as Membership[]).filter((m) => m.status === "ACTIVE" && MANAGER_ROLES.has(m.role));
      const activeFlags = await Promise.all(candidates.map((m) => isGlobalUserActive(m.userId)));
      return candidates.filter((_, i) => activeFlags[i]).map((m) => ({ userId: m.userId }));
    },
    async isActiveManager(tenantId: string, userId: string): Promise<boolean> {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: membershipKey(authorizedTenantIdFromPersistedEntity({ tenantId }), userId), ConsistentRead: true }));
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

/** D-300 (`reminder-producer-implementation-plan-scoping/DECISION.md` §1/§5): real
 * `SendMessageBatch` adapter for `scan-page.ts`'s `ClaimQueuePort` - chunks of <=10 candidates
 * are the CALLER's responsibility (scan-page.ts itself), this adapter just sends exactly the
 * chunk it's given and maps the SDK's per-entry `Failed` array to the port's outcome shape. */
export function buildReminderClaimQueuePort(sqsClient: SQSClient, queueUrl: string): ClaimQueuePort {
  return {
    async sendMessageBatch(entries: ClaimCandidateCommand[]): Promise<SendMessageBatchOutcome> {
      const result = await sqsClient.send(
        new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: entries.map((e) => ({
            Id: e.messageId,
            MessageBody: JSON.stringify(e),
            MessageAttributes: { correlationId: { DataType: "String", StringValue: e.correlationId } },
          })),
        }),
      );
      const failedEntryIds = (result.Failed ?? []).map((f) => ({ id: f.Id ?? "unknown", senderFault: f.SenderFault === true }));
      return { failedEntryIds };
    },
  };
}

/** Deps for `scan-page.ts`'s `runScanPage` (SQS scan-continuation-driven side of the dual-trigger
 * `reminder-producer-handler.ts`). `rolloutEpoch` is read from `SCAN_MODE_EPOCH` by the handler,
 * never defaulted here - see that handler for the env var contract. */
export function buildReminderScanPageDeps(client: DynamoDBDocumentClient, tableName: string, sqsClient: SQSClient, claimQueueUrl: string, rolloutEpoch: number) {
  const store = new DynamoDbReminderProducerStore(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    claimQueue: buildReminderClaimQueuePort(sqsClient, claimQueueUrl),
    tableName,
    now: () => new Date().toISOString(),
    newEventId: () => ids.newEventId(),
    correlationId: () => newCorrelationId(),
    rolloutEpoch,
    // DECISION.md §3: 200 candidates/page, 200s lease duration.
    pageSize: 200,
    leaseDurationMs: 200_000,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

/** Deps for `enumerate-and-lease.ts`'s `runEnumerationTick` (EventBridge Scheduler side of the
 * dual-trigger handler under `SCAN_MODE=PAGED`). */
export function buildReminderEnumerationDeps(client: DynamoDBDocumentClient, tableName: string, rolloutEpoch: number) {
  const store = new DynamoDbReminderProducerStore(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    shardConfig: defaultShardConfig(),
    tableName,
    now: () => new Date().toISOString(),
    newEventId: () => ids.newEventId(),
    correlationId: () => newCorrelationId(),
    rolloutEpoch,
    leaseDurationMs: 200_000,
    newOwnerToken: () => randomUUID(),
  };
}

/** Deps for the new claim-consumer Lambda (`reminder-claim-consumer-handler.ts`) -
 * DELIBERATELY built on `DynamoDbReminderStore`, never `DynamoDbReminderProducerStore` (the
 * ONLY class with `queryGsi3`/`queryGsi3Page`) - this Lambda must never even structurally have
 * the ability to reach GSI3, mirroring the "isolation enforced structurally" discipline
 * reminder-store.ts's own file header describes for the existing producer/reconciliation split.
 * The claim-consumer's IAM role (Terraform) omits `gsi3_read` entirely; this is the
 * corresponding code-level guarantee. */
export function buildReminderClaimConsumerDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReminderStore(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    tableName,
    now: () => new Date().toISOString(),
    claimTtlMs: 2 * 60_000,
    newEventId: () => ids.newEventId(),
    correlationId: () => newCorrelationId(),
  };
}

export function buildReconciliationDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbReminderStore(client, tableName);
  const candidateSource = new DynamoDbReminderReconciliationCandidateSource(client, tableName);
  const ids = new UlidIdGenerator();
  return {
    store,
    candidateSource,
    tableName,
    now: () => new Date().toISOString(),
    // D-300 (DECISION.md §7): only consumed by the SCANLEASE pass's reclaim transaction - the
    // pre-existing CLAIMS/DST passes above have no use for these, added here rather than as a
    // separate deps builder purely for composition-root convenience (both passes' Lambda still
    // shares one client/store).
    newEventId: () => ids.newEventId(),
    correlationId: () => newCorrelationId(),
  };
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
  // D-204 fatia 3 (Roadmap P1 item 15): SIXTH optional sender - the scheduled-reports
  // scheduler (D-212) dispatches this destination in the same TWI as its claim `Update` on
  // `ReportSubscription`. Same bare-event-data shape (`runId`/`subscriptionId`/`tenantId`/
  // `scheduledFor`) as the other bare-payload destinations above -
  // report-subscription-delivery-handler.ts never trusts anything beyond those four fields.
  reportSubscriptionDeliveryQueueUrl?: string,
  // D-205 fatia 2 (Roadmap P1 item 16): SEVENTH optional sender -
  // `DocumentArchiveService.confirmDossierExport` dispatches this destination in the same TWI
  // as its `DossierExportRun` status Update (CONFIRMED). Same bare-event-data shape
  // (`runId`/`subjectId`/`tenantId`) as the other bare-payload destinations above.
  dossierExportQueueUrl?: string,
  // D-226 (Roadmap P0 item 9): EIGHTH optional sender - `buildDocumentRequestCreatedOutboxEntry`
  // dispatches this destination in the same TWI that creates/reissues a `DocumentRequest`. Same
  // bare-event-data shape (`tenantId`/`subjectId`/`documentRequestId`/`issuanceGeneration`) as the
  // other bare-payload destinations above - document-request-credential-issuance-handler.ts (the
  // GUEST Lambda, holds the D-146 pepper) never trusts anything beyond those four fields, always
  // re-reads the authoritative DocumentRequest.
  guestCredentialIssuanceQueueUrl?: string,
  // D-300 (reminder-producer-implementation-plan-scoping/DECISION.md §4): NINTH optional sender -
  // EVERY ReminderScanLease transition (acquire/reclaim/checkpoint-with-more-pages) dispatches
  // this destination in the same TWI as the lease write. Same bare-envelope shape as
  // SQS_REMINDER_DISPATCH_V1 above (payload IS the full SqsCommandEnvelope, not re-wrapped) -
  // the dual-trigger reminder-producer-handler.ts's SQS path reads it directly.
  reminderScanContinuationQueueUrl?: string,
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
      ...(reportSubscriptionDeliveryQueueUrl ? { SQS_REPORT_SUBSCRIPTION_DELIVERY_V1: send(reportSubscriptionDeliveryQueueUrl) } : {}),
      ...(dossierExportQueueUrl ? { SQS_DOSSIER_EXPORT_V1: send(dossierExportQueueUrl) } : {}),
      ...(guestCredentialIssuanceQueueUrl ? { SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1: send(guestCredentialIssuanceQueueUrl) } : {}),
      ...(materializationTriggerQueueUrl ? { SQS_REMINDER_MATERIALIZATION_TRIGGER_V1: sendMaterializationTrigger(materializationTriggerQueueUrl) } : {}),
      ...(reminderScanContinuationQueueUrl ? { SQS_REMINDER_SCAN_CONTINUATION_V1: send(reminderScanContinuationQueueUrl) } : {}),
    },
  };
}

/** Round-3 finding of the D-300 4th-bug incident (2026-09-16, `reminder-producer-
 * implementation-plan-scoping/DECISION.md` §8 second rollback): `buildOutboxRelayDeps` above was
 * ALWAYS correct - it has taken `reminderScanContinuationQueueUrl` as an optional trailing
 * parameter since D-300 first shipped. The bug was entirely in
 * `dispatch-outbox-relay-handler.ts`'s own env-var reads, which never grew a 13th line to read
 * `REMINDER_SCAN_CONTINUATION_QUEUE_URL` and pass it through - invisible to `tsc` because a
 * missing trailing optional argument is a structurally valid call. A test against the helper
 * alone could never catch that specific omission (the helper was never wrong); only a test
 * against the REAL handler's own env-to-deps composition can. This function IS that composition,
 * extracted so it's unit-testable with a fake `env` object instead of 13 real env vars + a real
 * `SQSClient` construction just to import the handler module - the real handler module now does
 * nothing but call this with `process.env` at import time. */
export function buildDispatchOutboxRelayDepsFromEnv(env: Record<string, string | undefined>, client: DynamoDBDocumentClient, sqsClient: SQSClient = new SQSClient({})) {
  const tableName = env["TABLE_NAME"];
  const queueUrl = env["DISPATCH_QUEUE_URL"];
  const chasingQueueUrl = env["DOCUMENT_CHASING_DISPATCH_QUEUE_URL"];
  const importCommitQueueUrl = env["IMPORT_COMMIT_QUEUE_URL"];
  const materializationTriggerQueueUrl = env["REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL"];
  const importParseQueueUrl = env["IMPORT_PARSE_QUEUE_URL"];
  const requirementEvidenceRefreshQueueUrl = env["REQUIREMENT_EVIDENCE_REFRESH_QUEUE_URL"];
  const reportSubscriptionDeliveryQueueUrl = env["REPORT_SUBSCRIPTION_DELIVERY_QUEUE_URL"];
  const dossierExportQueueUrl = env["DOSSIER_EXPORT_QUEUE_URL"];
  const guestCredentialIssuanceQueueUrl = env["GUEST_CREDENTIAL_ISSUANCE_QUEUE_URL"];
  // D-300 §4/§8 (2026-09-16 fix): tenth real destination on this relay - see the class comment
  // above `buildOutboxRelayDeps` and `OutboxDestination`'s own D-300 doc comment in outbox.ts.
  const reminderScanContinuationQueueUrl = env["REMINDER_SCAN_CONTINUATION_QUEUE_URL"];
  if (!tableName) throw new Error("TABLE_NAME env var is required.");
  if (!queueUrl) throw new Error("DISPATCH_QUEUE_URL env var is required.");
  if (!chasingQueueUrl) throw new Error("DOCUMENT_CHASING_DISPATCH_QUEUE_URL env var is required.");
  if (!importCommitQueueUrl) throw new Error("IMPORT_COMMIT_QUEUE_URL env var is required.");
  if (!materializationTriggerQueueUrl) throw new Error("REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL env var is required.");
  if (!importParseQueueUrl) throw new Error("IMPORT_PARSE_QUEUE_URL env var is required.");
  if (!requirementEvidenceRefreshQueueUrl) throw new Error("REQUIREMENT_EVIDENCE_REFRESH_QUEUE_URL env var is required.");
  if (!reportSubscriptionDeliveryQueueUrl) throw new Error("REPORT_SUBSCRIPTION_DELIVERY_QUEUE_URL env var is required.");
  if (!dossierExportQueueUrl) throw new Error("DOSSIER_EXPORT_QUEUE_URL env var is required.");
  if (!guestCredentialIssuanceQueueUrl) throw new Error("GUEST_CREDENTIAL_ISSUANCE_QUEUE_URL env var is required.");
  if (!reminderScanContinuationQueueUrl) throw new Error("REMINDER_SCAN_CONTINUATION_QUEUE_URL env var is required.");
  return buildOutboxRelayDeps(
    client,
    tableName,
    queueUrl,
    sqsClient,
    chasingQueueUrl,
    importCommitQueueUrl,
    materializationTriggerQueueUrl,
    importParseQueueUrl,
    requirementEvidenceRefreshQueueUrl,
    reportSubscriptionDeliveryQueueUrl,
    dossierExportQueueUrl,
    guestCredentialIssuanceQueueUrl,
    reminderScanContinuationQueueUrl,
  );
}

/** Same D-300 4th-bug fix (2026-09-16), for `outbox-sweeper-handler.ts`. Unlike the relay, the
 * sweeper never called `buildOutboxRelayDeps` at all - it built its own inline `senders` map
 * (M4 design doc §7.4's "router keyed by destination" on a shared privileged role), so its gap
 * was a missing map entry entirely, not a missing constructor argument. Extracted here for the
 * exact same testability reason as `buildDispatchOutboxRelayDepsFromEnv` above - the real
 * `outbox-sweeper-handler.ts` module now only calls this with `process.env` and adds its own
 * `leaseOwner` at invocation time (that part is genuinely per-invocation state, not composition,
 * so it deliberately stays in the handler). */
export function buildOutboxSweeperDepsFromEnv(env: Record<string, string | undefined>, client: DynamoDBDocumentClient, sqsClient: SQSClient = new SQSClient({})) {
  const tableName = env["TABLE_NAME"];
  const reminderDispatchQueueUrl = env["DISPATCH_QUEUE_URL"];
  const emailDeliverQueueUrl = env["EMAIL_DELIVER_QUEUE_URL"];
  const chasingDispatchQueueUrl = env["DOCUMENT_CHASING_DISPATCH_QUEUE_URL"];
  const importCommitQueueUrl = env["IMPORT_COMMIT_QUEUE_URL"];
  const materializationTriggerQueueUrl = env["REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL"];
  const importParseQueueUrl = env["IMPORT_PARSE_QUEUE_URL"];
  const requirementEvidenceRefreshQueueUrl = env["REQUIREMENT_EVIDENCE_REFRESH_QUEUE_URL"];
  const reportSubscriptionDeliveryQueueUrl = env["REPORT_SUBSCRIPTION_DELIVERY_QUEUE_URL"];
  const dossierExportQueueUrl = env["DOSSIER_EXPORT_QUEUE_URL"];
  const guestCredentialIssuanceQueueUrl = env["GUEST_CREDENTIAL_ISSUANCE_QUEUE_URL"];
  const whatsAppDeliverQueueUrl = env["WHATSAPP_DELIVER_QUEUE_URL"];
  // D-300 §4/§8 (2026-09-16 fix): twelfth destination on this sweeper - see
  // `buildDispatchOutboxRelayDepsFromEnv` above for the matching relay-side fix and the full
  // incident history.
  const reminderScanContinuationQueueUrl = env["REMINDER_SCAN_CONTINUATION_QUEUE_URL"];
  if (!tableName) throw new Error("TABLE_NAME env var is required.");
  if (!reminderDispatchQueueUrl) throw new Error("DISPATCH_QUEUE_URL env var is required.");
  if (!emailDeliverQueueUrl) throw new Error("EMAIL_DELIVER_QUEUE_URL env var is required.");
  if (!chasingDispatchQueueUrl) throw new Error("DOCUMENT_CHASING_DISPATCH_QUEUE_URL env var is required.");
  if (!importCommitQueueUrl) throw new Error("IMPORT_COMMIT_QUEUE_URL env var is required.");
  if (!materializationTriggerQueueUrl) throw new Error("REMINDER_MATERIALIZATION_TRIGGER_QUEUE_URL env var is required.");
  if (!importParseQueueUrl) throw new Error("IMPORT_PARSE_QUEUE_URL env var is required.");
  if (!requirementEvidenceRefreshQueueUrl) throw new Error("REQUIREMENT_EVIDENCE_REFRESH_QUEUE_URL env var is required.");
  if (!reportSubscriptionDeliveryQueueUrl) throw new Error("REPORT_SUBSCRIPTION_DELIVERY_QUEUE_URL env var is required.");
  if (!dossierExportQueueUrl) throw new Error("DOSSIER_EXPORT_QUEUE_URL env var is required.");
  if (!guestCredentialIssuanceQueueUrl) throw new Error("GUEST_CREDENTIAL_ISSUANCE_QUEUE_URL env var is required.");
  if (!whatsAppDeliverQueueUrl) throw new Error("WHATSAPP_DELIVER_QUEUE_URL env var is required.");
  if (!reminderScanContinuationQueueUrl) throw new Error("REMINDER_SCAN_CONTINUATION_QUEUE_URL env var is required.");

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
  // BLOCKER-B: unlike the other destinations' payloads, this one is the bare domain event data
  // (matches schemas/events/*.json), not a self-describing command - fold in the record's own
  // tenantId/eventType before sending (mirrors buildOutboxRelayDeps's own sendMaterializationTrigger).
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
      SQS_REMINDER_DISPATCH_V1: send(reminderDispatchQueueUrl),
      SQS_NOTIFICATION_EMAIL_V1: send(emailDeliverQueueUrl),
      SQS_DOCUMENT_CHASING_DISPATCH_V1: send(chasingDispatchQueueUrl),
      SQS_IMPORT_COMMIT_V1: send(importCommitQueueUrl),
      SQS_IMPORT_PARSE_V1: send(importParseQueueUrl),
      SQS_REQUIREMENT_EVIDENCE_REFRESH_V1: send(requirementEvidenceRefreshQueueUrl),
      SQS_REPORT_SUBSCRIPTION_DELIVERY_V1: send(reportSubscriptionDeliveryQueueUrl),
      SQS_DOSSIER_EXPORT_V1: send(dossierExportQueueUrl),
      SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1: send(guestCredentialIssuanceQueueUrl),
      SQS_NOTIFICATION_WHATSAPP_V1: send(whatsAppDeliverQueueUrl),
      SQS_REMINDER_MATERIALIZATION_TRIGGER_V1: sendMaterializationTrigger(materializationTriggerQueueUrl),
      SQS_REMINDER_SCAN_CONTINUATION_V1: send(reminderScanContinuationQueueUrl),
    },
  };
}
