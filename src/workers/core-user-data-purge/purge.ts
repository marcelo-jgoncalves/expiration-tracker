/**
 * CoreUserDataPurgeWorker — D-151, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `CORE_USER_DATA` row, Prioridade 1). Physically purges `ExpirationItem`/`ReminderPolicy` rows
 * once `deletedAt + 30 days` (`privacy-lgpd.md` §4: "exclusão/encerramento + 30 dias") has
 * passed — the ONLY existing purge path for these entities today is a full tenant closure
 * (`src/workers/tenant-purge/`), a separate mechanism entirely; this worker is additive,
 * per-record retention WITHIN an `ACTIVE` tenant.
 *
 * Pure logic, clock-injected, same layout as `requirement-reindex/reindex.ts` — candidates come
 * from one `Scan` (see `candidate-source.ts`'s doc comment for why Scan, not GSI6), this module
 * never touches DynamoDB directly.
 *
 * Two independent eligibility fences, both required:
 *   1. Age — `deletedAt` must be at least `RETENTION_DAYS` (30) old.
 *   2. Tenant ACTIVE — the owning tenant's `TenantLifecycleRecord.status` must be `ACTIVE`. A
 *      tenant mid-closure (any other status, including a missing record) is the tenant-purge
 *      pipeline's job, never this worker's — see `candidate-source.ts`'s
 *      `TenantLifecycleStatusSource` doc comment for the fail-closed missing-record rule.
 *
 * The physical delete itself is OCC-fenced (`buildVersionedDelete`) with an EXTRA condition
 * re-asserting `deletedAt` is still set to the EXACT value the scan observed — this worker's
 * single most important correctness property (task brief): if a record were ever un-deleted
 * between the scan and this delete (no such path exists in this codebase today for either
 * entity, but the condition is what makes that structurally safe rather than merely
 * "safe because nothing does it yet"), the delete's ConditionExpression fails closed instead of
 * silently discarding a live record.
 */
import { buildVersionedDelete, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import type { CoreUserDataPurgeCandidateSource, TenantLifecycleStatusSource } from "./candidate-source.js";

export const CORE_USER_DATA_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ACTIVE-only fence (see file header) — a single named constant so the eligibility check
 * reads as a comparison against the one lifecycle status this worker is allowed to act under,
 * not a magic string repeated at each call site. Intentionally NOT imported from
 * `tenant-lifecycle-record.ts` (`shared/tenant-lifecycle/**`): this worker only ever needs the
 * bare string, and importing the full lifecycle module here would pull an unrelated,
 * much-larger dependency surface into a small additive worker for a single constant. */
const TENANT_ACTIVE_STATUS = "ACTIVE";

export interface CoreUserDataPurgeDeps {
  candidates: CoreUserDataPurgeCandidateSource;
  lifecycle: TenantLifecycleStatusSource;
  tableName: string;
  now: () => string;
}

export interface CoreUserDataPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
}

/** Hard cap on pages drained per invocation — same rationale as `requirement-reindex`/
 * `reminder-reconciliation-handler.ts`'s `MAX_PAGES`: bounds a single invocation against a
 * pathological backlog; anything beyond this is picked up by the next scheduled run. */
const MAX_PAGES = 25;

export function isPurgeEligibleByAge(deletedAt: string, nowIso: string): boolean {
  const cutoffMs = Date.parse(deletedAt) + CORE_USER_DATA_RETENTION_DAYS * MS_PER_DAY;
  return cutoffMs <= Date.parse(nowIso);
}

export async function runCoreUserDataPurge(deps: CoreUserDataPurgeDeps): Promise<CoreUserDataPurgeResult> {
  const result: CoreUserDataPurgeResult = {
    scanned: 0,
    purged: 0,
    skippedTooRecent: 0,
    skippedTenantNotActive: 0,
    skippedConcurrentlyModified: 0,
  };
  const nowIso = deps.now();

  // Cache lifecycle status per tenant within this run — a single scan page can carry many
  // candidates for the same tenant, and the status cannot change mid-run in a way that would
  // make a stale cached ACTIVE read unsafe (the delete's own OCC condition is the real fence
  // against any concurrent mutation of the CANDIDATE itself; this cache only avoids redundant
  // reads of a DIFFERENT record, the TenantLifecycleRecord, which this worker never writes to).
  const tenantStatusCache = new Map<string, string | undefined>();
  async function tenantIsActive(tenantId: string): Promise<boolean> {
    if (!tenantStatusCache.has(tenantId)) {
      tenantStatusCache.set(tenantId, await deps.lifecycle.getStatus(tenantId));
    }
    return tenantStatusCache.get(tenantId) === TENANT_ACTIVE_STATUS;
  }

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const scanPage = await deps.candidates.scanDeletedCandidates(exclusiveStartKey);
    for (const candidate of scanPage.items) {
      result.scanned += 1;

      if (!isPurgeEligibleByAge(candidate.deletedAt, nowIso)) {
        result.skippedTooRecent += 1;
        continue;
      }

      if (!(await tenantIsActive(candidate.tenantId))) {
        result.skippedTenantNotActive += 1;
        continue;
      }

      const del = buildVersionedDelete({
        tableName: deps.tableName,
        key: { PK: candidate.PK, SK: candidate.SK },
        tenantId: candidate.tenantId,
        expectedVersion: candidate.version,
        extraConditions: [
          // The single most important correctness property here (task brief): re-assert
          // deletedAt is still set to the EXACT value this scan observed, so a concurrent
          // restore (setting a different deletedAt, or removing it) between scan and delete
          // never gets silently overwritten by this delete.
          { expression: "deletedAt = :deletedAt", values: { ":deletedAt": candidate.deletedAt } },
        ],
      });

      try {
        await deps.candidates.deleteCandidate(del);
        result.purged += 1;
      } catch (err) {
        if (isConditionalCheckFailed(err)) {
          result.skippedConcurrentlyModified += 1;
          continue;
        }
        throw err;
      }
    }
    if (!scanPage.lastEvaluatedKey) break;
    exclusiveStartKey = scanPage.lastEvaluatedKey;
  }

  return result;
}
