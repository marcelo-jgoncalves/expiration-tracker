/** Real DynamoDB adapter for ExtractionRunStore. Same translation pattern as
 * DynamoDbDocumentStore/DynamoDbReminderStore. */
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey } from "../ports/extraction-run-store.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";

export class DynamoDbExtractionRunStore implements ExtractionRunStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key }));
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "ExtractionRunStore.get");
    }
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "ExtractionRunStore.putIfAbsent");
    }
  }

  async updateStatus(key: EntityKey, tenantId: string, expectedVersion: number, status: "DISCARDED", completedAt: string): Promise<boolean> {
    const command = buildVersionedUpdate({
      tableName: this.tableName,
      key,
      tenantId,
      expectedVersion,
      set: { status, completedAt },
    });
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: command.TableName,
          Key: command.Key,
          UpdateExpression: command.UpdateExpression,
          ConditionExpression: command.ConditionExpression,
          ExpressionAttributeNames: command.ExpressionAttributeNames,
          ExpressionAttributeValues: command.ExpressionAttributeValues,
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "ExtractionRunStore.updateStatus");
    }
  }
}
