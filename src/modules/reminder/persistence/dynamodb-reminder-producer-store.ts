/**
 * Real DynamoDB adapter for ReminderProducerStore (M3.5). Deliberately a SEPARATE class
 * from DynamoDbReminderStore (never a shared "does everything" adapter) - the only place
 * `queryGsi3` exists, matching the port-level isolation documented in
 * src/modules/reminder/ports/reminder-store.ts. Only wired into the ReminderProducer
 * Lambda's composition root.
 */
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, Gsi3QueryInput, ReminderProducerStore, TransactWriteEntry } from "../ports/reminder-store.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbReminderProducerStore implements ReminderProducerStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryGsi3<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3QueryInput): Promise<T[]> {
    try {
      const items: T[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: "GSI3",
            KeyConditionExpression: "GSI3PK = :pk",
            ExpressionAttributeValues: { ":pk": input.gsi3pk },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        items.push(...((result.Items ?? []) as T[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return items;
    } catch (err) {
      throw mapDynamoError(err, "ReminderProducerStore.queryGsi3");
    }
  }

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(
        new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }),
      );
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "ReminderProducerStore.get");
    }
  }

  // No try/catch: TransactionCanceledException must reach the caller as-is - see DynamoDbReminderStore.transactWrite.
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"],
      }),
    );
  }
}
