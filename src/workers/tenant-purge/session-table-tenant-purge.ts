/**
 * bff-session-table tenant purge — W3-07 (this session). `infra/modules/bff-session-table` is a
 * SEPARATE physical DynamoDB table from the main single-table design (D-054's deliberate
 * isolation — only the BFF Lambda's role reads/writes it), so it is structurally unreachable from
 * `TenantBusinessMutation`/`SystemMutation`'s single-table `TransactWriteItems` fence (both lanes
 * target one `tableName`). This is why `w3-07-writer-inventory.md` lists BFF session writes as
 * "NOT FENCED — structurally out of reach of the current fence" — a separate purge path, not the
 * main table's `PURGE_DELETE` lane, is the only way to remove this table's tenant-owned rows.
 *
 * Known structural gap, honestly documented rather than silently narrowed (per this session's
 * scope guidance to pick the safest reasonable default and keep moving rather than stall):
 * `Session` rows declare `tenantId` (see `src/modules/bff/domain/session.ts`) and so CAN be
 * tenant-scoped here; `LoginAttempt` rows do NOT — they are keyed `LOGINATTEMPT#<selectorHash>`
 * with no tenant association at all (by design: rate-limiting/login-attempt tracking happens
 * BEFORE a guest token resolves a tenant, same reason `tenant-business-mutation.ts`'s header
 * lists it as one of the two entities this codebase's fence structurally cannot reach). This
 * module therefore purges `Session` rows only; `LoginAttempt` rows are left to their own
 * natural TTL/expiry rather than claimed as purged here. There is also no GSI on this table
 * (`infra/modules/bff-session-table/main.tf`'s own comment: "no GSIs... every access pattern is
 * a point lookup by selectorHash, never a query") — enumeration is necessarily a table Scan
 * filtered by `tenantId`, same class of mechanism as the main table's tenant scan.
 */
export interface SessionTableScanItem {
  PK: string;
  SK: string;
  tenantId?: string;
  [key: string]: unknown;
}

export interface SessionTableScanPage {
  items: SessionTableScanItem[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface SessionTablePurgeSource {
  /** Real adapter: `Scan` with `FilterExpression: tenantId = :tenantId` — see file header for why
   * this cannot be a Query (no GSI, no tenantId in the key). */
  scanTenantSessions(tenantId: string, exclusiveStartKey?: Record<string, unknown>): Promise<SessionTableScanPage>;
  /** Unconditional `DeleteItem` — idempotent at the DynamoDB API level regardless of whether the
   * key still exists, same discipline `S3OcrArtifactStore.delete()` already documents for S3.
   * No OCC condition needed: this table's rows have no version scheme (see
   * `src/modules/bff/domain/session.ts`), and a purge target is never concurrently mutated by a
   * business writer once the tenant has left ACTIVE. */
  deleteSession(key: { PK: string; SK: string }): Promise<void>;
}

export interface SessionTableTenantPurgeDeps {
  source: SessionTablePurgeSource;
  onCheckpoint?: (lastEvaluatedKey: Record<string, unknown> | undefined) => Promise<void>;
}

export interface SessionTableTenantPurgeResult {
  sessionsPurged: number;
}

export async function purgeTenantSessions(
  deps: SessionTableTenantPurgeDeps,
  input: { tenantId: string; startAfter?: Record<string, unknown> },
): Promise<SessionTableTenantPurgeResult> {
  let sessionsPurged = 0;
  let exclusiveStartKey = input.startAfter;

  for (;;) {
    const page = await deps.source.scanTenantSessions(input.tenantId, exclusiveStartKey);

    for (const item of page.items) {
      // Defense-in-depth: the scan is already filtered server-side, but never trust a
      // caller-side filter alone for something this sensitive (same discipline as the main
      // table's exclusion set in dynamo-tenant-purge.ts).
      if (item.tenantId !== input.tenantId) continue;
      await deps.source.deleteSession({ PK: item.PK, SK: item.SK });
      sessionsPurged += 1;
    }

    exclusiveStartKey = page.lastEvaluatedKey;
    if (deps.onCheckpoint) await deps.onCheckpoint(exclusiveStartKey);
    if (!exclusiveStartKey) break;
  }

  return { sessionsPurged };
}
