/**
 * Real DynamoDB adapter for `InvitationPurgeCandidateSource`/`TenantLifecycleStatusSource`
 * (D-155) — separate class, wired only into the InvitationPurgeWorker Lambda's composition root,
 * same pattern as `quota-telemetry-purge/dynamodb-candidate-source.ts`. A base-table `Scan` + a
 * strongly-consistent `GetItem` on the tenant's own `TenantLifecycleRecord` — neither touches
 * GSI3/GSI6.
 */
import { DeleteCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isConditionalCheckFailed, type DynamoDeleteCommandInput } from "../../shared/dynamodb/occ.js";
import type {
  InvitationPurgeCandidate,
  InvitationPurgeCandidateSource,
  InvitationPurgeScanPage,
  TenantLifecycleStatusSource,
} from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;

export class DynamoDbInvitationPurgeCandidateSource implements InvitationPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<InvitationPurgeScanPage> {
    try {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: "#entityType = :invitation AND (#status = :revoked OR #status = :pending)",
          ExpressionAttributeNames: { "#entityType": "entityType", "#status": "status" },
          ExpressionAttributeValues: { ":invitation": "Invitation", ":revoked": "REVOKED", ":pending": "PENDING" },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      const items = (result.Items ?? []) as InvitationPurgeCandidate[];
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      throw mapDynamoError(err, "InvitationPurgeCandidateSource.scanCandidates");
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
      // Left unmapped for a conditional-check failure, same discipline as the other purge
      // workers' adapters: purge.ts inspects isConditionalCheckFailed() itself to distinguish
      // "lost the race, safe to skip" from every other DynamoDB failure.
      if (isConditionalCheckFailed(err)) throw err;
      throw mapDynamoError(err, "InvitationPurgeCandidateSource.deleteCandidate");
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
