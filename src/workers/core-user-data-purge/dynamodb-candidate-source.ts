/**
 * Real DynamoDB adapter for `CoreUserDataPurgeCandidateSource`/`TenantLifecycleStatusSource`
 * (D-151) — separate class, wired only into the CoreUserDataPurgeWorker Lambda's composition
 * root, same pattern as `dynamodb-document-purge-candidate-source.ts`. A base-table `Scan` +
 * a strongly-consistent `GetItem` on the tenant's own `TenantLifecycleRecord` — neither touches
 * GSI3/GSI6, so no `security-audit.ts` global-index-access logging is needed here (that
 * taxonomy is specifically for the two isolated indexes, per `AGENTS.md` §7).
 */
import { DeleteCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isConditionalCheckFailed, type DynamoDeleteCommandInput } from "../../shared/dynamodb/occ.js";
import type { CoreUserDataPurgeCandidate, CoreUserDataPurgeCandidateSource, CoreUserDataScanPage, TenantLifecycleStatusSource } from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;

export class DynamoDbCoreUserDataPurgeCandidateSource implements CoreUserDataPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async scanDeletedCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<CoreUserDataScanPage> {
    try {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "(#entityType = :item OR #entityType = :policy) AND attribute_exists(#deletedAt)",
          ExpressionAttributeNames: { "#entityType": "entityType", "#deletedAt": "deletedAt" },
          ExpressionAttributeValues: { ":item": "ExpirationItem", ":policy": "ReminderPolicy" },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      return {
        items: (result.Items ?? []) as CoreUserDataPurgeCandidate[],
        lastEvaluatedKey: result.LastEvaluatedKey,
      };
    } catch (err) {
      throw mapDynamoError(err, "CoreUserDataPurgeCandidateSource.scanDeletedCandidates");
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
      // Left unmapped for a conditional-check failure (same discipline sdk-errors.ts's own doc
      // comment states for TransactionCanceledException): `purge.ts` inspects
      // `isConditionalCheckFailed()` itself to distinguish "lost the OCC/restore race, safe to
      // skip" from every other DynamoDB failure — mapping it here would erase the SDK error
      // name that check depends on.
      if (isConditionalCheckFailed(err)) throw err;
      throw mapDynamoError(err, "CoreUserDataPurgeCandidateSource.deleteCandidate");
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
