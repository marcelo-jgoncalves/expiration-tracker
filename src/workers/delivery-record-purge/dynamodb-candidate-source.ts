/**
 * Real DynamoDB adapter for `DeliveryRecordPurgeCandidateSource`/`TenantLifecycleStatusSource`
 * (D-179/D-18x, 8th slice) — separate class, wired only into the DeliveryRecordPurgeWorker
 * Lambda's composition root, same pattern as `security-audit-purge/dynamodb-candidate-source.ts`.
 * `queryDue()` is the ONLY GSI8 access this role's IAM policy permits (`dynamodb:LeadingKeys`
 * scoped to `WORK#DELIVERY_RECORD`/`DLQ#DELIVERY_RECORD`, `infra/modules/dynamo-table/main.tf`) —
 * every other method touches the base table only.
 */
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isTransactionCanceled, type EntityKey, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type {
  DeliveryRecordEntityType,
  DeliveryRecordGsi8Candidate,
  DeliveryRecordGsi8Page,
  DeliveryRecordPurgeCandidate,
  DeliveryRecordPurgeCandidateSource,
  TenantLifecycleStatusSource,
} from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_DELIVERY_RECORD_PURGE = "WORK#DELIVERY_RECORD";

/** `GSI8SK` shape is `<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>`
 * (`deliveryRecordGsi8Keys()`, `shared/delivery-record-gsi8.ts`) — parsed here, not re-exported
 * from the shared module, since only this adapter ever sees a raw GSI8 row. `sk` itself may
 * contain further `#` (e.g. `ATTEMPT#000001#<id>`), so only the first two segments after
 * `#TENANT#` are consumed as tenantId/entityType; the remainder is ignored here (the adapter
 * already has the raw `SK` from the same GSI8 result row). */
function parseGsi8Sk(gsi8sk: string): { tenantId: string; entityType: DeliveryRecordEntityType } {
  const parts = gsi8sk.split("#TENANT#");
  const tenantSegment = parts[1];
  if (parts.length !== 2 || !tenantSegment) {
    throw new Error(`Malformed GSI8SK for delivery-record-purge: ${gsi8sk}`);
  }
  const [tenantId, entityType] = tenantSegment.split("#");
  if (!tenantId || !entityType) {
    throw new Error(`Malformed GSI8SK for delivery-record-purge: ${gsi8sk}`);
  }
  return { tenantId, entityType: entityType as DeliveryRecordEntityType };
}

export class DynamoDbDeliveryRecordPurgeCandidateSource implements DeliveryRecordPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<DeliveryRecordGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_DELIVERY_RECORD_PURGE, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: DeliveryRecordGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        const { tenantId, entityType } = parseGsi8Sk(row.GSI8SK);
        return { PK: row.PK, SK: row.SK, dueAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId, entityType };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "delivery-record-purge", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "delivery-record-purge", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "DeliveryRecordPurgeCandidateSource.queryDue");
    }
  }

  async getCandidate(key: EntityKey): Promise<DeliveryRecordPurgeCandidate | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      return result.Item as DeliveryRecordPurgeCandidate | undefined;
    } catch (err) {
      throw mapDynamoError(err, "DeliveryRecordPurgeCandidateSource.getCandidate");
    }
  }

  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: entries.map((entry) => {
            if ("Put" in entry) return { Put: entry.Put };
            if ("Update" in entry) return { Update: entry.Update };
            if ("Delete" in entry) return { Delete: entry.Delete };
            return { ConditionCheck: entry.ConditionCheck };
          }),
        }),
      );
    } catch (err) {
      // Left unmapped for a transaction cancellation, same discipline as security-audit-purge's
      // adapter: purge.ts inspects isTransactionCanceled()/getCancellationReasonCodes() itself.
      if (isTransactionCanceled(err)) throw err;
      throw mapDynamoError(err, "DeliveryRecordPurgeCandidateSource.transactWrite");
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
