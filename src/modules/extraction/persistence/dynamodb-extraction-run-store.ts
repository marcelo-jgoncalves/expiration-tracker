/** Real DynamoDB adapter for ExtractionRunStore. Same translation pattern as
 * DynamoDbDocumentStore/DynamoDbReminderStore. */
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey } from "../ports/extraction-run-store.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbExtractionRunStore implements ExtractionRunStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)" }));
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "ExtractionRunStore.putIfAbsent");
    }
  }
}
