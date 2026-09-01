/**
 * InvitationPurgeWorker — D-155, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `ACCOUNT_ACTIVE (não-fechamento)` row, Prioridade 5). Physically purges `Invitation` rows
 * (`src/modules/organization/domain/invitation.ts`) once terminal + 30 days
 * (`privacy-lgpd.md` §4: "encerramento + 30 dias", read here as the row's OWN non-closure
 * termination, not the tenant's — see `candidate-source.ts`'s doc comment for the full
 * investigation) has passed, for a tenant that is itself still `ACTIVE`.
 *
 * **Scope note (crux of D-155, do not re-litigate without re-reading the investigation)**: the
 * design doc names this priority `Invitation`→`Membership`→`Channel`. Only `Invitation` is
 * implemented here. `Membership`'s `REMOVED` state has NO timestamp field at all (`remove-
 * membership.ts`/`leave-organization.ts` set `status = REMOVED` and bump `version`, never a
 * `removedAt`/`updatedAt`) — there is no eligibility clock to check
 * "30 days since termination" against, so no purge logic can be written for it without first
 * adding a new field to two existing write paths, which is a design decision beyond "implement
 * the already-approved worker" and is left to the orchestrating session. `Channel` does not exist
 * as a named persisted entity anywhere in the codebase; the closest real candidate,
 * `NotificationPreferences` (`src/modules/notification/domain/notification-preferences.ts`,
 * one-per-user-per-tenant), has no terminal state either — it is never touched when its owning
 * `Membership` is removed (orphaned, not marked), so it inherits the exact same missing-timestamp
 * blocker as `Membership` and additionally has no direct signal of its own that it should be
 * purged (it would need to join against `Membership.status`, which itself lacks the clock). Both
 * are genuine "investigation says this doesn't map cleanly yet" findings, not scope creep.
 *
 * Pure logic, clock-injected, same layout as `quota-telemetry-purge/purge.ts` — candidates come
 * from one `Scan` (see `candidate-source.ts`), this module never touches DynamoDB directly.
 *
 * Two independent eligibility fences, both required (same shape as D-151/D-152/D-153/D-154):
 *   1. Age — the row's own terminal timestamp (`revokedAt` for REVOKED, `expiresAt` for a PENDING
 *      row past its own deadline — see `candidate-source.ts`) must be at least `RETENTION_DAYS`
 *      (30) in the past.
 *   2. Tenant ACTIVE — the owning tenant's (`organizationId`) `TenantLifecycleRecord.status` must
 *      be `ACTIVE`.
 *
 * **Delete re-asserts `version`** (unlike D-153/D-154, which had no `version` field to check):
 * `Invitation` DOES carry a real `version` counter (bumped nowhere today — no writer currently
 * increments it on `REVOKED`/`ACCEPTED`, but the field exists and is asserted unchanged as the
 * "hasn't moved since scan" fence, same intent as `buildVersionedDelete` without its `tenantId`
 * attribute requirement, since `Invitation` stores `organizationId`, not `tenantId`, as its
 * tenant-scoping field name).
 */
import { buildConditionalDelete, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import type { InvitationPurgeCandidateSource, TenantLifecycleStatusSource } from "./candidate-source.js";

export const INVITATION_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ACTIVE-only fence (see file header) — same bare-string rationale as the other purge workers'
 * own constant. */
const TENANT_ACTIVE_STATUS = "ACTIVE";

export interface InvitationPurgeDeps {
  candidates: InvitationPurgeCandidateSource;
  lifecycle: TenantLifecycleStatusSource;
  tableName: string;
  now: () => string;
}

export interface InvitationPurgeResult {
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

/** The row's own terminal timestamp — `revokedAt` for `REVOKED`, `expiresAt` for a `PENDING` row
 * that never got resolved (see `candidate-source.ts` for why `expiresAt` stands in for a never-
 * written `expiredAt`). Returns `undefined` for any other status, which callers treat as
 * ineligible rather than crashing — defensive against a scan somehow returning an `ACCEPTED` row
 * despite the filter expression (belt-and-suspenders, not an expected path). */
export function terminalTimestamp(candidate: { status: string; expiresAt: string; revokedAt?: string }): string | undefined {
  if (candidate.status === "REVOKED") return candidate.revokedAt;
  if (candidate.status === "PENDING") return candidate.expiresAt;
  return undefined;
}

export function isPurgeEligibleByTermination(terminatedAt: string, nowIso: string): boolean {
  const cutoffMs = Date.parse(terminatedAt) + INVITATION_RETENTION_DAYS * MS_PER_DAY;
  return cutoffMs <= Date.parse(nowIso);
}

export async function runInvitationPurge(deps: InvitationPurgeDeps): Promise<InvitationPurgeResult> {
  const result: InvitationPurgeResult = {
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

      const terminatedAt = terminalTimestamp(candidate);
      if (!terminatedAt || !isPurgeEligibleByTermination(terminatedAt, nowIso)) {
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
