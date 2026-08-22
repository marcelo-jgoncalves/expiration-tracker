/** Real DynamoDB adapter for DocumentStore (M6). Same translation pattern as
 * DynamoDbReminderStore/DynamoDbExpirationStore. */
import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, DocumentStore, TransactWriteEntry } from "../ports/document-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbDocumentStore implements DocumentStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey, consistentRead = true): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: consistentRead }));
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "DocumentStore.get");
    }
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "DocumentStore.putIfAbsent");
    }
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "DocumentStore.update");
    }
  }

  // TransactionCanceledException must reach the caller as-is - never wrapped by mapDynamoError.
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({ TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] }),
    );
  }
}
