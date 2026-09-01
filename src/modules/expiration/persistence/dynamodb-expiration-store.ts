/**
 * Real DynamoDB adapter for ExpirationStore (M3.5). `transactWrite` executes the
 * TransactWriteItems parameter shapes already produced by shared/dynamodb/occ.ts's
 * builders (buildVersionedCreate/buildVersionedUpdate) and shared/outbox/outbox.ts's
 * appendToTransaction - this adapter does not reconstruct OCC/idempotency/outbox logic,
 * only executes the SDK command.
 */
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, ExpirationStore, Gsi1PageInput, Gsi1Page, TransactWriteEntry } from "../ports/expiration-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbExpirationStore implements ExpirationStore {
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
      throw mapDynamoError(err, "ExpirationStore.get");
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
      throw mapDynamoError(err, "ExpirationStore.putIfAbsent");
    }
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "ExpirationStore.update");
    }
  }

  // TransactionCanceledException must reach the caller as-is (isTransactionCanceled() is
  // how callers distinguish OCC/idempotency conflicts from other failures) - never wrapped
  // by mapDynamoError, so no try/catch here.
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"],
      }),
    );
  }

  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]> {
    try {
      const items: T[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :prefix)" : "PK = :pk",
            ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":prefix": skPrefix } : { ":pk": pk },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        items.push(...((result.Items ?? []) as T[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return items;
    } catch (err) {
      throw mapDynamoError(err, "ExpirationStore.queryByPk");
    }
  }

  /** D-136/D-E: one real QueryCommand per call - never an internal accumulate-across-pages
   * loop (the pre-D-136 version did that and then `slice(0, limit)`'d the result, so its
   * returned `LastEvaluatedKey` could point past items the sliced-off result never actually
   * returned to the caller - a real cursor-skip bug found in the D-136/D-E protocol). A
   * DynamoDB `Query` can stop on `Limit` OR the 1 MB response-size ceiling, whichever comes
   * first; `LastEvaluatedKey` always reflects the actual stopping point of THIS call, so a
   * page's own cursor is always correct to resume from, regardless of which limit stopped it. */
  async queryGsi1Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi1PageInput): Promise<Gsi1Page<T>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: { ":pk": input.gsi1pk },
          ScanIndexForward: input.ascending ?? true,
          Limit: input.limit,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      return { items: (result.Items ?? []) as T[], lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      throw mapDynamoError(err, "ExpirationStore.queryGsi1Page");
    }
  }
}
