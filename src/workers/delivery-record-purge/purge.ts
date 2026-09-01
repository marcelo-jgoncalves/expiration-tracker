/**
 * DeliveryRecordPurgeWorker — D-152, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `DELIVERY_RECORD` row, Prioridade 2). Physically purges `NotificationIntent`/
 * `NotificationAttempt` rows once `createdAt + 180 days` (`privacy-lgpd.md` §4: "criação + 180
 * dias") has passed — the ONLY existing purge path for these entities today is a full tenant
 * closure (`src/workers/tenant-purge/`), a separate mechanism entirely; this worker is
 * additive, per-record retention WITHIN an `ACTIVE` tenant.
 *
 * **Explicitly verified NOT `SECURITY_AUDIT`** (task brief's scope check): `privacy-lgpd.md` §4
 * line 41 maps `DELIVERY_RECORD` to "intents/attempts", a row apart from line 43's
 * `SECURITY_AUDIT` ("AuditEvent/logs redigidos, MembershipAuditEvent"). `AuditEvent`
 * (`src/modules/expiration/domain/audit-event.ts`) and `MembershipAuditEvent` are never scanned
 * or deleted by this worker — see `candidate-source.ts`'s `entityType` union, which names only
 * `NotificationIntent`/`NotificationAttempt`.
 *
 * Key difference from `CORE_USER_DATA` (D-151): eligibility here is age-only against
 * `createdAt` — every delivery record eventually ages out regardless of any deletion action,
 * unlike `CORE_USER_DATA`'s `deletedAt`-gated (soft-delete-triggered) eligibility. There is no
 * "is this deleted" fence to re-check, and no natural business field analogous to `deletedAt`
 * to re-assert against an undelete race (delivery records have no undelete path at all) — the
 * conditional delete's OCC `version` check (`buildVersionedDelete`'s base condition) is
 * therefore the ENTIRE "hasn't changed since scan" fence, with `createdAt` re-asserted as an
 * extra condition purely as defense-in-depth (nothing in this codebase mutates `createdAt`
 * today, but re-asserting the exact eligibility field observed at scan time, same discipline as
 * D-151, means a future write to that field would fail this delete closed rather than silently
 * racing it). The ACTIVE-tenant fence is unchanged from D-151 (same reasoning: a tenant
 * mid-closure is the OTHER pipeline's job, never this worker's).
 *
 * Pure logic, clock-injected, same layout as `core-user-data-purge/purge.ts` — candidates come
 * from one `Scan` (see `candidate-source.ts`'s doc comment for why Scan, not GSI6), this module
 * never touches DynamoDB directly.
 */
import { buildVersionedDelete, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import type { DeliveryRecordPurgeCandidateSource, TenantLifecycleStatusSource } from "./candidate-source.js";

export const DELIVERY_RECORD_RETENTION_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ACTIVE-only fence (see file header) — same bare-string rationale as
 * `core-user-data-purge/purge.ts`'s own constant: this worker only ever needs the bare string,
 * importing the full tenant-lifecycle module here would pull an unrelated, much-larger
 * dependency surface into a small additive worker for a single constant. */
const TENANT_ACTIVE_STATUS = "ACTIVE";

export interface DeliveryRecordPurgeDeps {
  candidates: DeliveryRecordPurgeCandidateSource;
  lifecycle: TenantLifecycleStatusSource;
  tableName: string;
  now: () => string;
}

export interface DeliveryRecordPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
}

/** Hard cap on pages drained per invocation — same rationale as `core-user-data-purge/purge.ts`'s
 * `MAX_PAGES`: bounds a single invocation against a pathological backlog; anything beyond this
 * is picked up by the next scheduled run. */
const MAX_PAGES = 25;

export function isPurgeEligibleByAge(createdAt: string, nowIso: string): boolean {
  const cutoffMs = Date.parse(createdAt) + DELIVERY_RECORD_RETENTION_DAYS * MS_PER_DAY;
  return cutoffMs <= Date.parse(nowIso);
}

export async function runDeliveryRecordPurge(deps: DeliveryRecordPurgeDeps): Promise<DeliveryRecordPurgeResult> {
  const result: DeliveryRecordPurgeResult = {
    scanned: 0,
    purged: 0,
    skippedTooRecent: 0,
    skippedTenantNotActive: 0,
    skippedConcurrentlyModified: 0,
  };
  const nowIso = deps.now();

  // Cache lifecycle status per tenant within this run — same reasoning as
  // core-user-data-purge/purge.ts: a single scan page can carry many candidates for the same
  // tenant, and the delete's own OCC condition (not this cache) is the real fence against any
  // concurrent mutation of the CANDIDATE itself.
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

      if (!isPurgeEligibleByAge(candidate.createdAt, nowIso)) {
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
          // Defense-in-depth re-assertion of the exact eligibility field observed at scan time
          // (see file header) — nothing mutates createdAt today, but this makes "the field this
          // worker's eligibility decision depends on hasn't changed since the scan" structurally
          // guaranteed rather than merely true because nothing currently writes it.
          { expression: "createdAt = :createdAt", values: { ":createdAt": candidate.createdAt } },
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
