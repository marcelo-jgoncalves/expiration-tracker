/**
 * Real DynamoDB adapter for `SecurityAuditPurgeCandidateSource`/`TenantLifecycleStatusSource`
 * (D-179/D-187, 6th slice) — separate class, wired only into the SecurityAuditPurgeWorker
 * Lambda's composition root, same pattern as `quota-telemetry-purge/dynamodb-candidate-source.ts`.
 * `queryDue()` is the ONLY GSI8 access this role's IAM policy permits (`dynamodb:LeadingKeys`
 * scoped to `WORK#SECURITY_AUDIT`/`DLQ#SECURITY_AUDIT`, `infra/modules/dynamo-table/main.tf`) —
 * every other method touches the base table only.
 */
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isTransactionCanceled, type EntityKey, type TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import { auditGlobalIndexAccess, auditGlobalIndexAccessDenied, isAccessDeniedError } from "../../shared/observability/security-audit.js";
import type {
  SecurityAuditEntityType,
  SecurityAuditGsi8Candidate,
  SecurityAuditGsi8Page,
  SecurityAuditPurgeCandidate,
  SecurityAuditPurgeCandidateSource,
  TenantLifecycleStatusSource,
} from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;
const GSI8PK_SECURITY_AUDIT_PURGE = "WORK#SECURITY_AUDIT";

/** Raw scanned/gotten row shape before normalization — `MembershipAuditEvent` carries
 * `organizationId`, the other 3 carry `tenantId` directly (see `candidate-source.ts`'s doc
 * comment). */
interface RawSecurityAuditRow {
  PK: string;
  SK: string;
  entityType: SecurityAuditEntityType;
  tenantId?: string;
  organizationId?: string;
  occurredAt: string;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

/** `organizationId` -> `tenantId` normalization for `MembershipAuditEvent` — the ONE place this
 * mapping happens for a base-table row (see file header/`candidate-source.ts`). Throws rather
 * than silently continuing with an undefined tenantId, which should never happen for real data. */
function normalizeTenantId(row: RawSecurityAuditRow): string {
  const tenantId = row.tenantId ?? row.organizationId;
  if (!tenantId) {
    throw new Error(`SecurityAuditPurgeCandidateSource: row ${row.PK}/${row.SK} has neither tenantId nor organizationId.`);
  }
  return tenantId;
}

/** `GSI8SK` shape is `<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>` (`securityAuditGsi8Keys()`,
 * `shared/security-audit-gsi8.ts`) — parsed here, not re-exported from the shared module, since
 * only this adapter ever sees a raw GSI8 row. `sk` itself may contain further `#` (e.g.
 * `EVT#<timestamp>#<id>`), so only the first two segments after `#TENANT#` are consumed as
 * tenantId/entityType; the remainder (rejoined) is ignored here (the adapter already has the raw
 * `SK` from the same GSI8 result row). */
function parseGsi8Sk(gsi8sk: string): { tenantId: string; entityType: SecurityAuditEntityType } {
  const parts = gsi8sk.split("#TENANT#");
  const tenantSegment = parts[1];
  if (parts.length !== 2 || !tenantSegment) {
    throw new Error(`Malformed GSI8SK for security-audit-purge: ${gsi8sk}`);
  }
  const [tenantId, entityType] = tenantSegment.split("#");
  if (!tenantId || !entityType) {
    throw new Error(`Malformed GSI8SK for security-audit-purge: ${gsi8sk}`);
  }
  return { tenantId, entityType: entityType as SecurityAuditEntityType };
}

export class DynamoDbSecurityAuditPurgeCandidateSource implements SecurityAuditPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<SecurityAuditGsi8Page> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI8",
          KeyConditionExpression: "GSI8PK = :pk AND GSI8SK < :before",
          ExpressionAttributeValues: { ":pk": GSI8PK_SECURITY_AUDIT_PURGE, ":before": input.before },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: input.exclusiveStartKey,
        }),
      );
      const items: SecurityAuditGsi8Candidate[] = (result.Items ?? []).map((raw) => {
        const row = raw as { PK: string; SK: string; GSI8SK: string };
        const { tenantId, entityType } = parseGsi8Sk(row.GSI8SK);
        return { PK: row.PK, SK: row.SK, dueAtIso: row.GSI8SK.split("#TENANT#")[0]!, tenantId, entityType };
      });
      auditGlobalIndexAccess({ indexName: "GSI8", operation: "Query", component: "security-audit-purge", pageCount: 1, resultCount: items.length });
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      if (isAccessDeniedError(err)) {
        auditGlobalIndexAccessDenied({ indexName: "GSI8", operation: "Query", component: "security-audit-purge", awsErrorCode: "AccessDeniedException" });
      }
      throw mapDynamoError(err, "SecurityAuditPurgeCandidateSource.queryDue");
    }
  }

  async getCandidate(key: EntityKey): Promise<SecurityAuditPurgeCandidate | undefined> {
    try {
      const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }));
      const row = result.Item as RawSecurityAuditRow | undefined;
      if (!row) return undefined;
      return {
        PK: row.PK,
        SK: row.SK,
        entityType: row.entityType,
        tenantId: normalizeTenantId(row),
        occurredAt: row.occurredAt,
        maintenanceAttemptCount: row.maintenanceAttemptCount,
        GSI8PK: row.GSI8PK,
        GSI8SK: row.GSI8SK,
      };
    } catch (err) {
      throw mapDynamoError(err, "SecurityAuditPurgeCandidateSource.getCandidate");
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
      // Left unmapped for a transaction cancellation, same discipline as quota-telemetry-purge's
      // adapter: purge.ts inspects isTransactionCanceled()/getCancellationReasonCodes() itself.
      if (isTransactionCanceled(err)) throw err;
      throw mapDynamoError(err, "SecurityAuditPurgeCandidateSource.transactWrite");
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
