/**
 * Adapter DynamoDB real para ImportStore — mesmo padrão de
 * subject/persistence/dynamodb-subject-store.ts: executa os parâmetros já produzidos pelos
 * builders de shared/dynamodb/occ.ts, não reconstrói lógica de OCC/transação aqui.
 */
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, ImportStore, TransactWriteEntry } from "../ports/import-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbImportStore implements ImportStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "ImportStore.get");
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
      throw mapDynamoError(err, "ImportStore.putIfAbsent");
    }
  }

  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "ImportStore.update");
    }
  }

  // TransactionCanceledException precisa chegar intacta ao chamador (isTransactionCanceled())
  // - nunca envolvida por mapDynamoError, mesmo motivo dos outros stores.
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
      throw mapDynamoError(err, "ImportStore.queryByPk");
    }
  }
}
