/** Composition root for the reminder module and its async workers against real DynamoDB/SQS (M3.5). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDbReminderStore } from "../../../modules/reminder/persistence/dynamodb-reminder-store.js";
import { DynamoDbReminderProducerStore } from "../../../modules/reminder/persistence/dynamodb-reminder-producer-store.js";
import { DynamoDbReminderReconciliationCandidateSource } from "../../../modules/reminder/persistence/dynamodb-reconciliation-candidate-source.js";
import { DynamoDbOutboxRelayStore } from "../../../shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { ReminderPolicyService } from "../../../modules/reminder/application/reminder-policy-service.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import { UlidIdGenerator, newCorrelationId } from "../ids.js";

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
      ...(materializationTriggerQueueUrl ? { SQS_REMINDER_MATERIALIZATION_TRIGGER_V1: sendMaterializationTrigger(materializationTriggerQueueUrl) } : {}),
    },
  };
}
