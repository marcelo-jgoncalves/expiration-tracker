/**
 * Adapter DynamoDB real para SubjectStore — mesmo padrão de
 * expiration/persistence/dynamodb-expiration-store.ts: executa os parâmetros já produzidos
 * pelos builders de shared/dynamodb/occ.ts, não reconstrói lógica de OCC/transação aqui.
 */
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, Gsi7QueryInput, SubjectStore, TransactWriteEntry } from "../ports/subject-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbSubjectStore implements SubjectStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "SubjectStore.get");
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
      throw mapDynamoError(err, "SubjectStore.putIfAbsent");
    }
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "SubjectStore.update");
    }
  }

  async updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          // Mesma correção real de dynamodb-identity-store.ts: `count` é palavra reservada do
          // DynamoDB - exige ExpressionAttributeNames, nunca literal no ConditionExpression.
          ConditionExpression: "#count = :expectedCount AND resetAt = :expectedResetAt",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: { ":expectedCount": expected.count, ":expectedResetAt": expected.resetAt },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "SubjectStore.updateConditional");
    }
  }

  // TransactionCanceledException precisa chegar intacta ao chamador (isTransactionCanceled())
  // - nunca envolvida por mapDynamoError, mesmo motivo de dynamodb-expiration-store.ts.
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"],
      }),
    );
  }

  async queryGsi7<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi7QueryInput): Promise<T[]> {
    try {
      const items: T[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: "GSI7",
            KeyConditionExpression: "GSI7PK = :pk",
            ExpressionAttributeValues: { ":pk": input.gsi7pk },
            ScanIndexForward: input.ascending ?? true,
            Limit: input.limit,
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        items.push(...((result.Items ?? []) as T[]));
        exclusiveStartKey = result.LastEvaluatedKey;
        if (input.limit && items.length >= input.limit) break;
      } while (exclusiveStartKey);
      return input.limit ? items.slice(0, input.limit) : items;
    } catch (err) {
      throw mapDynamoError(err, "SubjectStore.queryGsi7");
    }
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
      throw mapDynamoError(err, "SubjectStore.queryByPk");
    }
  }
}
