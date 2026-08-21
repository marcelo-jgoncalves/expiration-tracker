/** Real DynamoDB adapter for NotificationStore (M4). Same translation pattern as
 * DynamoDbReminderStore/DynamoDbExpirationStore - see those files' headers for the shared
 * rationale (thin translation of already-tested OCC/idempotency builders, no reimplemented
 * concurrency logic here).
 *
 * `get`'s optional `consistentRead` parameter exists specifically for
 * docs/architecture/m4-notification-engine-design.md's rodada 3 fechamento #1: the
 * SesCallbackWorker MUST read the NotificationAttemptLookup pointer and the attempt itself
 * with ConsistentRead=true - an eventually consistent read could observe the pointer before
 * the attempt it points to, even though both were written in the same transaction.
 */
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, NotificationStore, TransactWriteEntry } from "../ports/notification-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbNotificationStore implements NotificationStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey, consistentRead = false): Promise<T | undefined> {
    try {
      const result = await this.client.send(
        new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: consistentRead }),
      );
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "NotificationStore.get");
    }
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "NotificationStore.putIfAbsent");
    }
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "NotificationStore.update");
    }
  }

  // TransactionCanceledException must reach the caller as-is (isTransactionCanceled() is how
  // callers distinguish OCC/idempotency conflicts from other failures) - never wrapped by
  // mapDynamoError, so no try/catch here. Same pattern as every other module's store.
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"],
      }),
    );
  }

  async queryAttemptsByIntent<T extends EntityKey = Record<string, unknown> & EntityKey>(tenantId: string, intentId: string): Promise<T[]> {
    try {
      const items: T[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :attemptPrefix)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}#INTENT#${intentId}`, ":attemptPrefix": "ATTEMPT#" },
            ConsistentRead: true,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        items.push(...((result.Items ?? []) as T[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return items;
    } catch (err) {
      throw mapDynamoError(err, "NotificationStore.queryAttemptsByIntent");
    }
  }
}
