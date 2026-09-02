/**
 * Real DynamoDB adapter for `TransientPurgeCandidateSource`/`TenantLifecycleStatusSource`
 * (D-179/D-188, 7th slice) — separate class, wired only into the TransientPurgeWorker Lambda's
 * composition root, same pattern as `security-audit-purge/dynamodb-candidate-source.ts`.
 * `queryDue()` is the ONLY GSI8 access this role's IAM policy permits (`dynamodb:LeadingKeys`
 * scoped to `WORK#TRANSIENT`/`DLQ#TRANSIENT`, `infra/modules/dynamo-table/main.tf`) — every other
 * method touches the base table only.
 */
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isTransactionCanceled, type EntityKey, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type { TransientGsi8EntityType } from "../../shared/transient-purge-gsi8.js";
import type { UploadSlotStatus } from "../../modules/document/domain/upload-slot.js";
import type {
  TransientGsi8Candidate,
  TransientGsi8Page,
  TransientPurgeCandidate,
  TransientPurgeCandidateSource,
  TenantLifecycleStatusSource,
  UploadSlotPurgeCandidate,
  WebhookInboxPurgeCandidate,
} from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_TRANSIENT_PURGE = "WORK#TRANSIENT";

/** Raw scanned/gotten row shape before normalization — covers both entities' distinct fields. */
interface RawTransientRow {
  PK: string;
  SK: string;
  entityType: TransientGsi8EntityType;
  tenantId: string;
  createdAt?: string;
  reservedAt?: string;
  status?: string;
  version: number;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

function normalizeCandidate(row: RawTransientRow): TransientPurgeCandidate {
  if (row.entityType === "WebhookInbox") {
    if (!row.createdAt) throw new Error(`TransientPurgeCandidateSource: WebhookInbox row ${row.PK}/${row.SK} missing createdAt.`);
    const candidate: WebhookInboxPurgeCandidate = {
      PK: row.PK,
      SK: row.SK,
      entityType: "WebhookInbox",
      tenantId: row.tenantId,
      createdAt: row.createdAt,
      version: row.version,
      maintenanceAttemptCount: row.maintenanceAttemptCount,
      GSI8PK: row.GSI8PK,
      GSI8SK: row.GSI8SK,
    };
    return candidate;
  }
  if (!row.reservedAt || !row.status) {
    throw new Error(`TransientPurgeCandidateSource: UploadSlot row ${row.PK}/${row.SK} missing reservedAt/status.`);
  }
  const candidate: UploadSlotPurgeCandidate = {
    PK: row.PK,
    SK: row.SK,
    entityType: "UploadSlot",
    tenantId: row.tenantId,
    reservedAt: row.reservedAt,
    status: row.status as UploadSlotStatus,
    version: row.version,
    maintenanceAttemptCount: row.maintenanceAttemptCount,
    GSI8PK: row.GSI8PK,
    GSI8SK: row.GSI8SK,
  };
  return candidate;
}

/** `GSI8SK` shape is `<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>` (`transientPurgeGsi8Keys()`,
 * `shared/transient-purge-gsi8.ts`) — parsed here, not re-exported from the shared module, since
 * only this adapter ever sees a raw GSI8 row (same discipline as `security-audit-purge`'s own
 * adapter). `sk` itself may contain further `#` (e.g. `EVENT#<snsMessageId>`), so only the first
 * two segments after `#TENANT#` are consumed as tenantId/entityType; the remainder is ignored here
 * (the adapter already has the raw `SK` from the same GSI8 result row). */
function parseGsi8Sk(gsi8sk: string): { tenantId: string; entityType: TransientGsi8EntityType } {
  const parts = gsi8sk.split("#TENANT#");
  const tenantSegment = parts[1];
  if (parts.length !== 2 || !tenantSegment) {
    throw new Error(`Malformed GSI8SK for transient-purge: ${gsi8sk}`);
  }
  const [tenantId, entityType] = tenantSegment.split("#");
  if (!tenantId || !entityType) {
    throw new Error(`Malformed GSI8SK for transient-purge: ${gsi8sk}`);
  }
  return { tenantId, entityType: entityType as TransientGsi8EntityType };
}

export class DynamoDbTransientPurgeCandidateSource implements TransientPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<TransientGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_TRANSIENT_PURGE, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: TransientGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        const { tenantId, entityType } = parseGsi8Sk(row.GSI8SK);
        return { PK: row.PK, SK: row.SK, dueAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId, entityType };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "transient-purge", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "transient-purge", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "TransientPurgeCandidateSource.queryDue");
    }
  }

  async getCandidate(key: EntityKey): Promise<TransientPurgeCandidate | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      const row = result.Item as RawTransientRow | undefined;
      if (!row) return undefined;
      return normalizeCandidate(row);
    } catch (err) {
      throw mapDynamoError(err, "TransientPurgeCandidateSource.getCandidate");
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
      throw mapDynamoError(err, "TransientPurgeCandidateSource.transactWrite");
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
