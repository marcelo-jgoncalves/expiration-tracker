/**
 * Real DynamoDB adapter for the dedicated BFF session table (D-054). Same thin
 * translate-only style as src/modules/identity/persistence/dynamodb-identity-store.ts - no
 * business logic here, only Get/Put/conditional-Put commands.
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, SessionStore } from "../ports/session-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbSessionStore implements SessionStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "SessionStore.get");
    }
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "SessionStore.putIfAbsent");
    }
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "SessionStore.update");
    }
  }

  async updateConditional<T extends EntityKey>(item: T, expected: { version: number }): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_exists(PK) AND #version = :expectedVersion",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: { ":expectedVersion": expected.version },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "SessionStore.updateConditional");
    }
  }
}
