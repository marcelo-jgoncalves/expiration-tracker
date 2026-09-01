/**
 * Real DynamoDB adapter for `DeliveryRecordPurgeCandidateSource`/`TenantLifecycleStatusSource`
 * (D-152) — separate class, wired only into the DeliveryRecordPurgeWorker Lambda's composition
 * root, same pattern as `core-user-data-purge/dynamodb-candidate-source.ts`. A base-table
 * `Scan` + a strongly-consistent `GetItem` on the tenant's own `TenantLifecycleRecord` — neither
 * touches GSI3/GSI6, so no `security-audit.ts` global-index-access logging is needed here (that
 * taxonomy is specifically for the two isolated indexes, per `AGENTS.md` §7).
 */
import { DeleteCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isConditionalCheckFailed, type DynamoDeleteCommandInput } from "../../shared/dynamodb/occ.js";
import type {
  DeliveryRecordPurgeCandidate,
  DeliveryRecordPurgeCandidateSource,
  DeliveryRecordScanPage,
  TenantLifecycleStatusSource,
} from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;

export class DynamoDbDeliveryRecordPurgeCandidateSource implements DeliveryRecordPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<DeliveryRecordScanPage> {
    try {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "(#entityType = :intent OR #entityType = :attempt) AND attribute_exists(#createdAt)",
          ExpressionAttributeNames: { "#entityType": "entityType", "#createdAt": "createdAt" },
          ExpressionAttributeValues: { ":intent": "NotificationIntent", ":attempt": "NotificationAttempt" },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      return {
        items: (result.Items ?? []) as DeliveryRecordPurgeCandidate[],
        lastEvaluatedKey: result.LastEvaluatedKey,
      };
    } catch (err) {
      throw mapDynamoError(err, "DeliveryRecordPurgeCandidateSource.scanCandidates");
    }
  }

  async deleteCandidate(input: DynamoDeleteCommandInput): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: input.TableName,
          Key: input.Key,
          ConditionExpression: input.ConditionExpression,
          ExpressionAttributeNames: input.ExpressionAttributeNames,
          ExpressionAttributeValues: input.ExpressionAttributeValues,
        }),
      );
    } catch (err) {
      // Left unmapped for a conditional-check failure, same discipline as
      // core-user-data-purge/dynamodb-candidate-source.ts: purge.ts inspects
      // isConditionalCheckFailed() itself to distinguish "lost the OCC race, safe to skip" from
      // every other DynamoDB failure — mapping it here would erase the SDK error name that check
      // depends on.
      if (isConditionalCheckFailed(err)) throw err;
      throw mapDynamoError(err, "DeliveryRecordPurgeCandidateSource.deleteCandidate");
    }
  }
}

export class DynamoDbTenantLifecycleStatusSource implements TenantLifecycleStatusSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async getStatus(tenantId: string): Promise<string | undefined> {
    try {
      const result = await this.client.send(
        new GetCommand({ TableName: this.tableName, Key: tenantLifecycleKey(tenantId), ConsistentRead: true }),
      );
      return (result.Item as TenantLifecycleRecord | undefined)?.status;
    } catch (err) {
      throw mapDynamoError(err, "TenantLifecycleStatusSource.getStatus");
    }
  }
}
