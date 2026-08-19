/**
 * Real DynamoDB adapter for IdentityStore (M3.5). Thin translation to
 * DynamoDBDocumentClient commands - no OCC/idempotency logic lives here, that's already
 * built by shared/dynamodb/occ.ts and shared/idempotency/idempotency.ts; this class only
 * executes the commands those builders produce (for `update`) and issues plain
 * Get/Put for the rest.
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbIdentityStore implements IdentityStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(
        new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }),
      );
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "IdentityStore.get");
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
      throw mapDynamoError(err, "IdentityStore.putIfAbsent");
    }
  }

  /** Unconditional overwrite - matches the fake's semantics (non-OCC bookkeeping writes only). */
  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "IdentityStore.update");
    }
  }
}
