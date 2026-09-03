/**
 * Real DynamoDB adapter for DocumentArchiveStore. `transactWrite` executes whatever
 * TransactWriteItems entries the application layer built via shared/dynamodb/occ.ts's
 * builders — this adapter does not construct `acceptVersion`'s transaction itself, only
 * executes the SDK command (same division of responsibility as
 * `DynamoDbExpirationStore.transactWrite`).
 */
import { BatchGetCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DocumentArchiveStore, EntityKey, IndexPage, IndexPageInput, ScanPage, TransactWriteEntry } from "../ports/document-archive-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

/** D-143 Decision 2: the partition-key attribute for each index this module uses — derived
 * here, never supplied by a caller (see `IndexPageInput`'s doc comment). GSI3/GSI4/GSI6 are
 * deliberately absent from this map: they are already contracted to reminder
 * scheduling/membership/global workstate with isolated IAM (`infra/modules/dynamo-table/
 * main.tf`), and this module must never be able to construct a query against them. */
const INDEX_PARTITION_KEY_ATTRIBUTE: Record<IndexPageInput["indexName"], string> = {
  GSI1: "GSI1PK",
  GSI2: "GSI2PK",
  GSI5: "GSI5PK",
  GSI9: "GSI9PK",
};

export class DynamoDbDocumentArchiveStore implements DocumentArchiveStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "DocumentArchiveStore.get");
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
      throw mapDynamoError(err, "DocumentArchiveStore.putIfAbsent");
    }
  }

  /** D-146 (guest access): same lost-update guard as `DynamoDbSubjectStore.updateConditional` —
   * `count` is a DynamoDB reserved word, requires `ExpressionAttributeNames`. */
  async updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "#count = :expectedCount AND resetAt = :expectedResetAt",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: { ":expectedCount": expected.count, ":expectedResetAt": expected.resetAt },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "DocumentArchiveStore.updateConditional");
    }
  }

  // TransactionCanceledException must reach the caller as-is (isTransactionCanceled() is how
  // callers distinguish OCC/idempotency conflicts from other failures) - never wrapped by
  // mapDynamoError, so no try/catch here (same discipline as DynamoDbExpirationStore).
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({ TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] }),
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
      throw mapDynamoError(err, "DocumentArchiveStore.queryByPk");
    }
  }

  /** One real QueryCommand per call — never an internal accumulate-across-pages loop (the
   * exact cursor-skip bug D-142 found and fixed for ExpirationStore's `queryGsi1Page`; this
   * module inherits that lesson rather than reintroducing it in a new port). */
  async queryIndexPage<T extends EntityKey = Record<string, unknown> & EntityKey>(input: IndexPageInput): Promise<IndexPage<T>> {
    try {
      const pkAttribute = INDEX_PARTITION_KEY_ATTRIBUTE[input.indexName];
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: input.indexName,
          KeyConditionExpression: "#pk = :pk",
          ExpressionAttributeNames: { "#pk": pkAttribute },
          ExpressionAttributeValues: { ":pk": input.partitionKeyValue },
          ScanIndexForward: input.ascending ?? true,
          Limit: input.limit,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      return { items: (result.Items ?? []) as T[], lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      throw mapDynamoError(err, "DocumentArchiveStore.queryIndexPage");
    }
  }

  /** Cross-tenant `Scan` for the recurrence materializer worker — see the port method's doc
   * comment for the accepted cost tradeoff. `requirement-reindex` used to have a sibling method
   * here (`scanSatisfiedRequirements`) — removed by D-179/D-185's GSI8 migration, same "delete
   * the dead mechanism, don't leave it beside the new one" discipline D-183 established. */
  async scanActiveSeries<T extends EntityKey = Record<string, unknown> & EntityKey>(exclusiveStartKey?: Record<string, unknown>): Promise<ScanPage<T>> {
    try {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "#entityType = :entityType AND #status = :status",
          ExpressionAttributeNames: { "#entityType": "entityType", "#status": "status" },
          ExpressionAttributeValues: { ":entityType": "DocumentRequestSeries", ":status": "ACTIVE" },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      return { items: (result.Items ?? []) as T[], lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      throw mapDynamoError(err, "DocumentArchiveStore.scanActiveSeries");
    }
  }

  /** D-192 §4 (fatia 6) — mesma disciplina de retry de `UnprocessedKeys` de
   * `DynamoDbSubjectStore.batchGet`: 100 chaves por chamada (limite do SDK), retry explícito
   * até esvaziar cada chunk (200 OK parcial, não falha de rede). */
  async batchGet<T extends EntityKey = Record<string, unknown> & EntityKey>(keys: EntityKey[]): Promise<T[]> {
    if (keys.length === 0) return [];
    try {
      const items: T[] = [];
      const CHUNK_SIZE = 100;
      for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
        let pending = keys.slice(i, i + CHUNK_SIZE);
        while (pending.length > 0) {
          const result = await this.client.send(
            new BatchGetCommand({
              RequestItems: { [this.tableName]: { Keys: pending as unknown as Record<string, unknown>[] } },
            }),
          );
          items.push(...((result.Responses?.[this.tableName] ?? []) as T[]));
          const unprocessed = result.UnprocessedKeys?.[this.tableName]?.Keys;
          pending = (unprocessed ?? []) as unknown as EntityKey[];
        }
      }
      return items;
    } catch (err) {
      throw mapDynamoError(err, "DocumentArchiveStore.batchGet");
    }
  }
}
