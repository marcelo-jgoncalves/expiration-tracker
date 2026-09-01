/**
 * QuotaTelemetryPurgeWorker — D-154, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `QUOTA_TELEMETRY` row, Prioridade 4). Physically purges `TenantQuotaRecord` rows
 * (`src/modules/identity/application/quota.ts`) once `resetAt + 30 days` (`privacy-lgpd.md` §4:
 * "fim da janela + 30 dias") has passed — the only entity in the "quotas/métricas identificáveis"
 * class with no existing expiry mechanism; see `candidate-source.ts`'s doc comment for the full
 * investigation of the other 4 rate-limit entities, all already resolved via native DynamoDB TTL.
 *
 * Pure logic, clock-injected, same layout as `security-audit-purge/purge.ts` — candidates come
 * from one `Scan` (see `candidate-source.ts`), this module never touches DynamoDB directly.
 *
 * Two independent eligibility fences, both required (same shape as D-151/D-152/D-153):
 *   1. Age — `resetAt` must be at least `RETENTION_DAYS` (30) in the past.
 *   2. Tenant ACTIVE — the owning tenant's `TenantLifecycleRecord.status` must be `ACTIVE`.
 *
 * **No OCC `version` field re-asserted at delete time** (same deviation as D-153, same reason):
 * `TenantQuotaRecord` has no `version` counter — `buildConditionalDelete` re-asserts `resetAt`
 * exactly as observed at scan time instead, so a concurrent `consume()`/`release()` that rolls the
 * window forward (or resets the count) between scan and delete aborts this worker's delete rather
 * than racing it.
 */
import { buildConditionalDelete, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import type { QuotaTelemetryPurgeCandidateSource, TenantLifecycleStatusSource } from "./candidate-source.js";

export const QUOTA_TELEMETRY_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ACTIVE-only fence (see file header) — same bare-string rationale as the other purge workers'
 * own constant. */
const TENANT_ACTIVE_STATUS = "ACTIVE";

export interface QuotaTelemetryPurgeDeps {
  candidates: QuotaTelemetryPurgeCandidateSource;
  lifecycle: TenantLifecycleStatusSource;
  tableName: string;
  now: () => string;
}

export interface QuotaTelemetryPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
}

/** Hard cap on pages drained per invocation — same rationale as the other purge workers'
 * `MAX_PAGES`: bounds a single invocation against a pathological backlog; anything beyond this is
 * picked up by the next scheduled run. */
const MAX_PAGES = 25;

export function isPurgeEligibleByWindowEnd(resetAt: string, nowIso: string): boolean {
  const cutoffMs = Date.parse(resetAt) + QUOTA_TELEMETRY_RETENTION_DAYS * MS_PER_DAY;
  return cutoffMs <= Date.parse(nowIso);
}

export async function runQuotaTelemetryPurge(deps: QuotaTelemetryPurgeDeps): Promise<QuotaTelemetryPurgeResult> {
  const result: QuotaTelemetryPurgeResult = {
    scanned: 0,
    purged: 0,
    skippedTooRecent: 0,
    skippedTenantNotActive: 0,
    skippedConcurrentlyModified: 0,
  };
  const nowIso = deps.now();

  // Cache lifecycle status per tenant within this run — same reasoning as the other purge
  // workers: a single scan page can carry many candidates for the same tenant, and the delete's
  // own conditional expression (not this cache) is the real fence against any concurrent
  // mutation of the CANDIDATE itself.
  const tenantStatusCache = new Map<string, string | undefined>();
  async function tenantIsActive(tenantId: string): Promise<boolean> {
    if (!tenantStatusCache.has(tenantId)) {
      tenantStatusCache.set(tenantId, await deps.lifecycle.getStatus(tenantId));
    }
    return tenantStatusCache.get(tenantId) === TENANT_ACTIVE_STATUS;
  }

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const scanPage = await deps.candidates.scanCandidates(exclusiveStartKey);
    for (const candidate of scanPage.items) {
      result.scanned += 1;

      if (!isPurgeEligibleByWindowEnd(candidate.resetAt, nowIso)) {
        result.skippedTooRecent += 1;
        continue;
      }

      if (!(await tenantIsActive(candidate.tenantId))) {
        result.skippedTenantNotActive += 1;
        continue;
      }

      const del = buildConditionalDelete({
        tableName: deps.tableName,
        key: { PK: candidate.PK, SK: candidate.SK },
        conditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #resetAt = :resetAt",
        names: { "#resetAt": "resetAt" },
        values: { ":resetAt": candidate.resetAt },
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
