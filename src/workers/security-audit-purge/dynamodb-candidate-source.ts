/**
 * Real DynamoDB adapter for `SecurityAuditPurgeCandidateSource`/`TenantLifecycleStatusSource`
 * (D-153) — separate class, wired only into the SecurityAuditPurgeWorker Lambda's composition
 * root, same pattern as `delivery-record-purge/dynamodb-candidate-source.ts`. A base-table `Scan`
 * + a strongly-consistent `GetItem` on the tenant's own `TenantLifecycleRecord` — neither touches
 * GSI3/GSI6, so no `security-audit.ts` global-index-access logging is needed here (that taxonomy
 * is specifically for the two isolated indexes, per `AGENTS.md` §7 — unrelated to this worker's
 * own name, which purges the `SECURITY_AUDIT` LGPD retention class, not that taxonomy module).
 */
import { DeleteCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { mapDynamoError } from "../../shared/dynamodb/sdk-errors.js";
import { isConditionalCheckFailed, type DynamoDeleteCommandInput } from "../../shared/dynamodb/occ.js";
import type {
  SecurityAuditPurgeCandidate,
  SecurityAuditPurgeCandidateSource,
  SecurityAuditScanPage,
  TenantLifecycleStatusSource,
} from "./candidate-source.js";

const PER_INVOCATION_LIMIT = 100;

/** Raw scanned row shape before normalization — `MembershipAuditEvent` carries `organizationId`,
 * the other 3 carry `tenantId` directly (see `candidate-source.ts`'s doc comment). */
interface RawSecurityAuditRow {
  PK: string;
  SK: string;
  entityType: SecurityAuditPurgeCandidate["entityType"];
  tenantId?: string;
  organizationId?: string;
  occurredAt: string;
}

/** `organizationId` -> `tenantId` normalization for `MembershipAuditEvent` — the ONE place this
 * mapping happens (see file header/`candidate-source.ts`). Throws rather than silently scanning
 * past a malformed row missing BOTH fields, which should never happen for real data (every
 * `AuditEvent`-family builder sets exactly one of the two) and would otherwise surface as a
 * confusing downstream `undefined` tenantId reaching the lifecycle lookup. */
function normalizeTenantId(row: RawSecurityAuditRow): string {
  const tenantId = row.tenantId ?? row.organizationId;
  if (!tenantId) {
    throw new Error(`SecurityAuditPurgeCandidateSource: row ${row.PK}/${row.SK} has neither tenantId nor organizationId.`);
  }
  return tenantId;
}

export class DynamoDbSecurityAuditPurgeCandidateSource implements SecurityAuditPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<SecurityAuditScanPage> {
    try {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression:
            "(#entityType = :audit OR #entityType = :membership OR #entityType = :subject OR #entityType = :tenant) AND attribute_exists(#occurredAt)",
          ExpressionAttributeNames: { "#entityType": "entityType", "#occurredAt": "occurredAt" },
          ExpressionAttributeValues: {
            ":audit": "AuditEvent",
            ":membership": "MembershipAuditEvent",
            ":subject": "SubjectAuditEvent",
            ":tenant": "TenantAuditEvent",
          },
          Limit: PER_INVOCATION_LIMIT,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      const items = ((result.Items ?? []) as RawSecurityAuditRow[]).map(
        (row): SecurityAuditPurgeCandidate => ({
          PK: row.PK,
          SK: row.SK,
          entityType: row.entityType,
          tenantId: normalizeTenantId(row),
          occurredAt: row.occurredAt,
        }),
      );
      return { items, lastEvaluatedKey: result.LastEvaluatedKey };
    } catch (err) {
      throw mapDynamoError(err, "SecurityAuditPurgeCandidateSource.scanCandidates");
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
      // "lost the race, safe to skip" from every other DynamoDB failure — mapping it here would
      // erase the SDK error name that check depends on.
      if (isConditionalCheckFailed(err)) throw err;
      throw mapDynamoError(err, "SecurityAuditPurgeCandidateSource.deleteCandidate");
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
