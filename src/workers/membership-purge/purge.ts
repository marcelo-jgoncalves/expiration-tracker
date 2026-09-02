/**
 * MembershipPurgeWorker — D-127's approved Prioridade 5 (`ACCOUNT_ACTIVE`, não-fechamento),
 * `Membership` leg, unblocked by D-158's `removedAt` field. Physically purges `Membership` rows
 * (`src/modules/organization/domain/membership.ts`) once `status = REMOVED` and `removedAt + 30
 * days` (`privacy-lgpd.md` §4: "encerramento + 30 dias", read as this row's own non-closure
 * termination, same reading D-155 used for `Invitation`) has passed, for a tenant that is itself
 * still `ACTIVE`.
 *
 * Pure logic, clock-injected, same layout as `invitation-purge/purge.ts` — candidates come from
 * one `Scan` (see `candidate-source.ts`), this module never touches DynamoDB directly.
 *
 * Two independent eligibility fences, both required (same shape as the rest of the family):
 *   1. Age — `removedAt` must be at least `RETENTION_DAYS` (30) in the past.
 *   2. Tenant ACTIVE — the owning tenant's (`organizationId`) `TenantLifecycleRecord.status` must
 *      be `ACTIVE`.
 *
 * Delete re-asserts `version` via `buildConditionalDelete` (not `buildVersionedDelete` — see
 * `candidate-source.ts`'s doc comment for why).
 */
import { buildConditionalDelete, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import type { MembershipPurgeCandidateSource, TenantLifecycleStatusSource } from "./candidate-source.js";

export const MEMBERSHIP_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ACTIVE-only fence (see file header) — same bare-string rationale as the other purge workers'
 * own constant. */
const TENANT_ACTIVE_STATUS = "ACTIVE";

export interface MembershipPurgeDeps {
  candidates: MembershipPurgeCandidateSource;
  lifecycle: TenantLifecycleStatusSource;
  tableName: string;
  now: () => string;
}

export interface MembershipPurgeResult {
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

export function isPurgeEligibleByRemoval(removedAt: string, nowIso: string): boolean {
  const cutoffMs = Date.parse(removedAt) + MEMBERSHIP_RETENTION_DAYS * MS_PER_DAY;
  return cutoffMs <= Date.parse(nowIso);
}

export async function runMembershipPurge(deps: MembershipPurgeDeps): Promise<MembershipPurgeResult> {
  const result: MembershipPurgeResult = {
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

      const removedAt = candidate.removedAt;
      if (!removedAt || !isPurgeEligibleByRemoval(removedAt, nowIso)) {
        result.skippedTooRecent += 1;
        continue;
      }

      if (!(await tenantIsActive(candidate.organizationId))) {
        result.skippedTenantNotActive += 1;
        continue;
      }

      const del = buildConditionalDelete({
        tableName: deps.tableName,
        key: { PK: candidate.PK, SK: candidate.SK },
        conditionExpression: "attribute_exists(PK) AND attribute_exists(SK) AND #version = :version",
        names: { "#version": "version" },
        values: { ":version": candidate.version },
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
