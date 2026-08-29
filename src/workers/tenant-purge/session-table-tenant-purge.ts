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
  /**
   * `DeleteItem` conditioned on the stored `tenantId` attribute still matching `expectedTenantId`
   * (or the item already being gone — idempotent, same discipline `S3OcrArtifactStore.delete()`
   * documents for S3). No OCC/version condition needed: this table's rows have no version scheme
   * (see `src/modules/bff/domain/session.ts`), and a purge target is never concurrently mutated by
   * a business writer once the tenant has left ACTIVE.
   *
   * W3-07 review finding (Codex round on the purge pipeline, B5, 2026-08-29): the previous
   * contract was an UNCONDITIONAL delete, with only a caller-side `item.tenantId !== tenantId`
   * check before calling it — a check/delete TOCTOU (the row could in theory be
   * replaced/repointed between the scan read and the delete call). `expectedTenantId` closes that
   * atomically: the delete itself now re-asserts tenant ownership server-side at commit time, not
   * only on the possibly-stale scanned copy. Must return `{ deleted: false }` (never throw) on a
   * conditional-check failure — the caller treats that as a safety rejection, same as
   * `PURGE_DELETE`'s `SystemMutationConflictError` on the main table.
   */
  deleteSession(key: { PK: string; SK: string }, expectedTenantId: string): Promise<{ deleted: boolean }>;
}

export interface SessionTableTenantPurgeDeps {
  source: SessionTablePurgeSource;
  onCheckpoint?: (lastEvaluatedKey: Record<string, unknown> | undefined) => Promise<void>;
}

export interface SessionTableTenantPurgeResult {
  sessionsPurged: number;
  /** Count of `deleteSession` calls whose server-side `expectedTenantId` condition failed —
   * see `SessionTablePurgeSource.deleteSession`'s doc comment (B5). Should always be 0 in
   * practice; a nonzero value means the row's stored `tenantId` changed between scan and delete,
   * or the scanned copy was already stale — `purge-tenant.ts` treats this as non-convergence,
   * never silently ignored. */
  sessionsRejectedBySafetyCondition: number;
}

/** Same rationale as `dynamo-tenant-purge.ts`'s `verifyTenantDynamoPurgeEmpty` (B2) — a full,
 * unconditional re-scan confirming zero `Session` rows remain for `tenantId`, called
 * unconditionally by `purge-tenant.ts` regardless of whether this run's own purge phase executed
 * or was skipped via a resumed checkpoint. */
export async function verifyTenantSessionsEmpty(
  deps: Pick<SessionTableTenantPurgeDeps, "source">,
  tenantId: string,
): Promise<{ remainingSessions: number }> {
  let remainingSessions = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  for (;;) {
    const page = await deps.source.scanTenantSessions(tenantId, exclusiveStartKey);
    for (const item of page.items) {
      if (item.tenantId === tenantId) remainingSessions += 1;
    }
    exclusiveStartKey = page.lastEvaluatedKey;
    if (!exclusiveStartKey) break;
  }

  return { remainingSessions };
}

export async function purgeTenantSessions(
  deps: SessionTableTenantPurgeDeps,
  input: { tenantId: string; startAfter?: Record<string, unknown> },
): Promise<SessionTableTenantPurgeResult> {
  let sessionsPurged = 0;
  let sessionsRejectedBySafetyCondition = 0;
  let exclusiveStartKey = input.startAfter;

  for (;;) {
    const page = await deps.source.scanTenantSessions(input.tenantId, exclusiveStartKey);

    for (const item of page.items) {
      // Defense-in-depth: the scan is already filtered server-side, but never trust a
      // caller-side filter alone for something this sensitive (same discipline as the main
      // table's exclusion set in dynamo-tenant-purge.ts). The delete call itself ALSO
      // re-asserts tenantId server-side (B5) — this check is a cheap early skip, not the
      // safety mechanism.
      if (item.tenantId !== input.tenantId) continue;
      const { deleted } = await deps.source.deleteSession({ PK: item.PK, SK: item.SK }, input.tenantId);
      if (deleted) sessionsPurged += 1;
      else sessionsRejectedBySafetyCondition += 1;
    }

    exclusiveStartKey = page.lastEvaluatedKey;
    if (deps.onCheckpoint) await deps.onCheckpoint(exclusiveStartKey);
    if (!exclusiveStartKey) break;
  }

  return { sessionsPurged, sessionsRejectedBySafetyCondition };
}
