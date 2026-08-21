/** Composition root for the reminder module and its async workers against real DynamoDB/SQS (M3.5). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDbReminderStore } from "../../../modules/reminder/persistence/dynamodb-reminder-store.js";
import { DynamoDbReminderProducerStore } from "../../../modules/reminder/persistence/dynamodb-reminder-producer-store.js";
import { DynamoDbReminderReconciliationCandidateSource } from "../../../modules/reminder/persistence/dynamodb-reconciliation-candidate-source.js";
import { DynamoDbOutboxRelayStore } from "../../../shared/outbox/persistence/dynamodb-outbox-relay-store.js";
import { ReminderPolicyService } from "../../../modules/reminder/application/reminder-policy-service.js";
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

export function buildOutboxRelayDeps(client: DynamoDBDocumentClient, tableName: string, queueUrl: string, sqsClient: SQSClient = new SQSClient({})) {
  const store = new DynamoDbOutboxRelayStore(client, tableName);
  return {
    store,
    now: () => new Date().toISOString(),
    senders: {
      SQS_REMINDER_DISPATCH_V1: async (payload: Record<string, unknown>, correlationId: string) => {
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(payload),
            MessageAttributes: { correlationId: { DataType: "String", StringValue: correlationId } },
          }),
        );
      },
    },
  };
}
