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
import { isConditionalCheckFailed } from "./occ.js";
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
    // W3-07 review finding (Codex round on the purge pipeline, B1, 2026-08-29): a PK-prefix-only
    // filter misses real tenant-owned entity types whose PK is NOT `TENANT#<id>#...` by design —
    // `GuestTokenPointer` (`GUESTTOKEN#<selectorHash>`) and `TextractJob` (`TEXTRACTJOB#<jobId>`)
    // are the two documented exceptions (see their domain files) that still declare `tenantId` as
    // a plain attribute. OR'ing in `tenantId = :tenantId` catches these (and any future exception
    // of the same shape) without needing a new GSI — same discipline as `findTenantMismatch`'s
    // declared-tenantId check on the business-mutation side. `IdentityMapping` also declares
    // `tenantId` and would now be returned by this scan too; it stays protected by the pure-logic
    // exclusion in `dynamo-tenant-purge.ts` (entityType) and, for `TenantLifecycleRecord`
    // specifically, by the canonical-key guard inside `PURGE_DELETE` itself (system-mutation.ts).
    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(PK, :prefix) OR tenantId = :tenantId",
        ExpressionAttributeValues: { ":prefix": `TENANT#${tenantId}#`, ":tenantId": tenantId },
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

  /**
   * Conditional delete — idempotent at the DynamoDB API level for an already-gone key
   * (`attribute_not_exists(PK)` half), and (B5 fix) re-asserts the stored `tenantId` attribute
   * still matches `expectedTenantId` server-side at commit time — this table's keys carry no
   * tenant prefix at all (unlike the main table), so this attribute-equality condition is the
   * only structural tenant-ownership guard available on the physical delete itself. Returns
   * `{ deleted: false }` on a conditional-check failure rather than throwing — the caller
   * (`session-table-tenant-purge.ts`) treats that as a safety-condition rejection, never a
   * fatal error.
   */
  async deleteSession(key: { PK: string; SK: string }, expectedTenantId: string): Promise<{ deleted: boolean }> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: key,
          ConditionExpression: "attribute_not_exists(PK) OR tenantId = :expectedTenantId",
          ExpressionAttributeValues: { ":expectedTenantId": expectedTenantId },
        }),
      );
      return { deleted: true };
    } catch (err) {
      if (isConditionalCheckFailed(err)) return { deleted: false };
      throw err;
    }
  }
}
