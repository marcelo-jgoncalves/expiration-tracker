/** Real DynamoDB adapter for AuditPartitionStore (D-149). Mirrors
 * expiration/persistence/dynamodb-expiration-store.ts's queryGsi1Page exactly, just against
 * the base table (PK/SK) instead of GSI1 — no new index needed, per the approved design. */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuditPartitionStore, AuditPartitionPageInput, AuditPartitionPage } from "../ports/audit-partition-store.js";
import { mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbAuditPartitionStore implements AuditPartitionStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryPage<T extends EntityKey = Record<string, unknown> & EntityKey>(input: AuditPartitionPageInput): Promise<AuditPartitionPage<T>> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": input.pk },
          ScanIndexForward: input.ascending,
          Limit: input.limit,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      return { items: (result.Items ?? []) as T[], lastEvaluatedKey: result.LastEvaluatedKey as EntityKey | undefined };
    } catch (err) {
      throw mapDynamoError(err, "AuditPartitionStore.queryPage");
    }
  }
}
