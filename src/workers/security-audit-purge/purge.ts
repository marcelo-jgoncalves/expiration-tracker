/**
 * SecurityAuditPurgeWorker — D-153, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `SECURITY_AUDIT` row, Prioridade 3). Physically purges the 4 `AuditEvent`-family rows
 * (`AuditEvent`/`MembershipAuditEvent`/`SubjectAuditEvent`/`TenantAuditEvent`) once
 * `occurredAt + 365 days` (`privacy-lgpd.md` §4: "criação + 365 dias", `occurredAt` being the
 * canonical creation clock for these immutable rows — see `candidate-source.ts`'s doc comment)
 * has passed — the ONLY existing purge path for these rows today is a full tenant closure
 * (`src/workers/tenant-purge/`), a separate mechanism entirely; this worker is additive,
 * per-record retention WITHIN an `ACTIVE` tenant.
 *
 * Pure logic, clock-injected, same layout as `delivery-record-purge/purge.ts` — candidates come
 * from one `Scan` (see `candidate-source.ts`'s doc comment for why Scan, not GSI6), this module
 * never touches DynamoDB directly.
 *
 * **Interaction with `GET /activity` (D-149), investigated (task brief)**: `ActivityService`
 * paginates each of these 4 partitions via a composite cursor holding the real `{PK,SK}` of the
 * last item consumed from that partition (`src/modules/activity/domain/cursor.ts`), passed back
 * as `ExclusiveStartKey` on the next page's `Query` (`dynamodb-audit-partition-store.ts`). A
 * DynamoDB `Query`'s `ExclusiveStartKey` is a pure B-tree position marker, not a reference to an
 * item that must still exist — the SDK/service resumes scanning key-order from that position
 * regardless of whether the item at that exact key was deleted in the meantime (this worker
 * running between two pages of an in-progress `GET /activity` pagination). Verified by reading
 * `src/modules/activity/persistence/dynamodb-audit-partition-store.ts`'s `queryPage`: it forwards
 * `exclusiveStartKey` straight into `QueryCommand`'s `ExclusiveStartKey` with no existence check,
 * no re-fetch of the item at that key, and no other logic keyed off it — there is no code path in
 * this codebase (adapter or `ActivityService`/`merge.ts` above it) that could behave differently
 * depending on whether that key's item still exists at query time, which is also exactly the
 * documented real AWS DynamoDB `Query`/`Scan` continuation-token contract (a purely positional
 * cursor, independent of the referenced item's existence). Conclusion: no correctness bug here,
 * no fix needed — a client mid-pagination when this worker purges an old event never sees a
 * crash, a skip, or a duplicate. No new test added for this specific finding: the codebase's own
 * convention (see `dynamodb-audit-partition-store.ts` and every purge worker's `dynamodb-
 * candidate-source.ts`) is to keep thin DynamoDB adapters untested pass-throughs, verified by
 * code reading rather than a mocked-SDK test — introducing one just for this file would be an
 * inconsistent one-off, not a gap in this worker's own coverage.
 *
 * Two independent eligibility fences, both required (same shape as D-151/D-152):
 *   1. Age — `occurredAt` must be at least `RETENTION_DAYS` (365) old.
 *   2. Tenant ACTIVE — the owning tenant's `TenantLifecycleRecord.status` must be `ACTIVE`.
 *
 * **No OCC `version` field re-asserted at delete time** (deviation from D-151/D-152's
 * `buildVersionedDelete`, deliberate — see `candidate-source.ts`'s doc comment): none of the 4
 * entities carries a `version` counter, because none of them is ever updated after creation.
 * `buildConditionalDelete` (occ.ts, added by this worker, symmetric to the pre-existing
 * `buildConditionalPut`) re-asserts `occurredAt` exactly as observed at scan time instead — same
 * defense-in-depth intent as D-151/D-152's extra condition (nothing writes `occurredAt` after
 * creation today either, but the condition makes "unchanged since scan" a structural guarantee,
 * not an accident of "nothing does it yet").
 */
import { buildConditionalDelete, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import type { SecurityAuditPurgeCandidateSource, TenantLifecycleStatusSource } from "./candidate-source.js";

export const SECURITY_AUDIT_RETENTION_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ACTIVE-only fence (see file header) — same bare-string rationale as
 * `delivery-record-purge/purge.ts`'s own constant: this worker only ever needs the bare string,
 * importing the full tenant-lifecycle module here would pull an unrelated, much-larger
 * dependency surface into a small additive worker for a single constant. */
const TENANT_ACTIVE_STATUS = "ACTIVE";

export interface SecurityAuditPurgeDeps {
  candidates: SecurityAuditPurgeCandidateSource;
  lifecycle: TenantLifecycleStatusSource;
  tableName: string;
  now: () => string;
}

export interface SecurityAuditPurgeResult {
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

export function isPurgeEligibleByAge(occurredAt: string, nowIso: string): boolean {
  const cutoffMs = Date.parse(occurredAt) + SECURITY_AUDIT_RETENTION_DAYS * MS_PER_DAY;
  return cutoffMs <= Date.parse(nowIso);
}

export async function runSecurityAuditPurge(deps: SecurityAuditPurgeDeps): Promise<SecurityAuditPurgeResult> {
  const result: SecurityAuditPurgeResult = {
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

      if (!isPurgeEligibleByAge(candidate.occurredAt, nowIso)) {
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
        conditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #occurredAt = :occurredAt",
        names: { "#occurredAt": "occurredAt" },
        values: { ":occurredAt": candidate.occurredAt },
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
