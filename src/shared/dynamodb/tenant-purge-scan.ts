/**
 * Real DynamoDB adapters for the W3-07 purge pipeline's scan-based candidate sources
 * (`workers/tenant-purge/{dynamo-tenant-purge,session-table-tenant-purge}.ts`'s ports). Lives in
 * `shared/dynamodb/` (not a module's `persistence/`) because a tenant-wide purge is cross-module
 * by nature — see `.dependency-cruiser.cjs`'s `no-raw-dynamodb-writes-outside-lanes` rule, which
 * allows raw `@aws-sdk/lib-dynamodb` access from exactly this directory.
 *
 * Both adapters use `ScanCommand`, not `QueryCommand` — see `dynamo-tenant-purge.ts`'s file
 * header for why (no GSI keyed purely by tenantId exists on either table). A full-table Scan is
 * acceptable here specifically because tenant deletion is rare and asynchronous (not a hot path),
 * unlike every other read in this codebase, which is Query-only by design.
 */
import { ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { TenantPurgeCandidateSource, TenantScanItem, TenantScanPage } from "../../workers/tenant-purge/dynamo-tenant-purge.js";
import type { SessionTablePurgeSource, SessionTableScanItem, SessionTableScanPage } from "../../workers/tenant-purge/session-table-tenant-purge.js";

/** Main table: every tenant-owned row's PK is `TENANT#<tenantId>#...` (universal convention,
 * confirmed by exhaustive grep across `src/modules/**\/domain` — see
 * `w3-07-writer-inventory.md`/`decisions-log.md` D-076 for the same convention already relied on
 * by `TenantBusinessMutation`'s PK cross-validation). */
export class DynamoDbTenantPurgeCandidateSource implements TenantPurgeCandidateSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly pageLimit = 500,
  ) {}

  async scanTenantItems(tenantId: string, exclusiveStartKey?: Record<string, unknown>): Promise<TenantScanPage> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(PK, :prefix)",
        ExpressionAttributeValues: { ":prefix": `TENANT#${tenantId}#` },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: this.pageLimit,
      }),
    );
    return {
      items: (result.Items ?? []) as TenantScanItem[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }
}

/** `bff-session-table`: separate physical table, no GSI, `tenantId` is a plain attribute (not
 * part of the key) on `Session` rows only — see `session-table-tenant-purge.ts`'s file header for
 * why `LoginAttempt` rows are out of reach of this adapter by design. */
export class DynamoDbSessionTablePurgeSource implements SessionTablePurgeSource {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly pageLimit = 500,
  ) {}

  async scanTenantSessions(tenantId: string, exclusiveStartKey?: Record<string, unknown>): Promise<SessionTableScanPage> {
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "tenantId = :tenantId",
        ExpressionAttributeValues: { ":tenantId": tenantId },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: this.pageLimit,
      }),
    );
    return {
      items: (result.Items ?? []) as SessionTableScanItem[],
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /** Unconditional delete — idempotent at the DynamoDB API level regardless of prior existence,
   * per this port's own doc comment. No tenant-prefix safety condition is possible here (this
   * table's keys carry no tenant prefix at all, unlike the main table) — the caller
   * (`session-table-tenant-purge.ts`) is what re-checks `item.tenantId` before ever calling this. */
  async deleteSession(key: { PK: string; SK: string }): Promise<void> {
    await this.client.send(new DeleteCommand({ TableName: this.tableName, Key: key }));
  }
}
