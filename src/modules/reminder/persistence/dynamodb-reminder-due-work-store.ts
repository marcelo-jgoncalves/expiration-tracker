import { BatchGetCommand, QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import type { ReminderDueWorkItem } from "../domain/reminder-due-work.js";
import type { DueWorkPage, ReminderDueWorkStore } from "../ports/reminder-due-work-store.js";

export class DynamoDbReminderDueWorkStore implements ReminderDueWorkStore {
  constructor(private readonly client: DynamoDBDocumentClient, private readonly tableName: string) {}

  async queryDuePage(input: {
    partitionKey: string;
    upperBound: string;
    exclusiveStartKey?: Record<string, unknown>;
    limit: number;
  }): Promise<DueWorkPage> {
    try {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        ConsistentRead: true,
        KeyConditionExpression: "PK = :pk AND SK <= :upperBound",
        ExpressionAttributeValues: { ":pk": input.partitionKey, ":upperBound": input.upperBound },
        ExclusiveStartKey: input.exclusiveStartKey,
        Limit: input.limit,
      }));
      return { items: (result.Items ?? []) as ReminderDueWorkItem[], lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      throw mapDynamoError(err, "ReminderDueWorkStore.queryDuePage");
    }
  }

  async getMany(keys: EntityKey[]): Promise<{ items: ReminderDueWorkItem[]; unprocessedKeys: EntityKey[] }> {
    if (keys.length === 0) return { items: [], unprocessedKeys: [] };
    if (keys.length > 100) throw new Error("ReminderDueWorkStore.getMany accepts at most 100 keys");
    try {
      const result = await this.client.send(new BatchGetCommand({
        RequestItems: { [this.tableName]: { Keys: keys, ConsistentRead: true } },
      }));
      return {
        items: (result.Responses?.[this.tableName] ?? []) as ReminderDueWorkItem[],
        unprocessedKeys: (result.UnprocessedKeys?.[this.tableName]?.Keys ?? []) as EntityKey[],
      };
    } catch (err) {
      throw mapDynamoError(err, "ReminderDueWorkStore.getMany");
    }
  }
}
