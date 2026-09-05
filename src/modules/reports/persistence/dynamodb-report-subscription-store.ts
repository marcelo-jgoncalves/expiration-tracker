/**
 * Real DynamoDB adapter for `ReportSubscriptionStore` (D-211 fatia 2). `transactWrite` executes
 * the TransactWriteItems parameter shapes already produced by `shared/dynamodb/occ.ts`'s
 * `buildVersionedUpdate` and `shared/outbox/outbox.ts`'s `appendToTransaction` - this adapter
 * does not reconstruct OCC/outbox logic, only executes the SDK command, same split as
 * `expiration/persistence/dynamodb-expiration-store.ts`.
 */
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, ReportSubscriptionStore, TransactWriteEntry } from "../ports/report-subscription-store.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbReportSubscriptionStore implements ReportSubscriptionStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "ReportSubscriptionStore.get");
    }
  }

  // TransactionCanceledException must reach the caller as-is (isTransactionCanceled() is how
  // callers distinguish OCC conflicts from other failures) - never wrapped by mapDynamoError,
  // same posture as DynamoDbExpirationStore.transactWrite.
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"],
      }),
    );
  }
}
