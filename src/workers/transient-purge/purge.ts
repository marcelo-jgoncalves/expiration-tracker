/**
 * TransientPurgeWorker — D-156, implementing D-127's approved scoping design
 * (`docs/architecture/reviews/quarantine-retention-scoping/estado-final-consolidado.md`,
 * `TRANSIENT` row, Prioridade 6). Physically purges `WebhookInbox` rows once `createdAt + 7 days`
 * has passed, and `UploadSlot` rows once their own `privacy-lgpd.md` §4 window has passed
 * (`reservedAt + 7 days` if the slot was ever `CONSUMED`, `reservedAt + 24 hours` otherwise) — see
 * `candidate-source.ts`'s doc comment for the full investigation of both entities.
 * `InvitationTokenPointer`, the third entity named on the same `privacy-lgpd.md` line, is already
 * resolved via native DynamoDB TTL and is untouched by this worker.
 *
 * Pure logic, clock-injected, same layout as `invitation-purge/purge.ts` — candidates come from one
 * `Scan` (see `candidate-source.ts`), this module never touches DynamoDB directly.
 *
 * Two independent eligibility fences, both required (same shape as D-151/152/153/154/155):
 *   1. Age — per-entity-type window (see above) must have passed.
 *   2. Tenant ACTIVE — the owning tenant's `TenantLifecycleRecord.status` must be `ACTIVE`.
 *
 * A `RESERVED` `UploadSlot` is never a purge candidate regardless of age — it is still an active,
 * in-flight reservation; only `CONSUMED`/`EXPIRED`/`RELEASED` slots are considered (see
 * `candidate-source.ts`'s doc comment).
 *
 * **Delete re-asserts `version`** (same shape as D-151/D-155, unlike D-153/D-154's `version`-less
 * entities): both `WebhookInbox` and `UploadSlot` carry a real `version` counter bumped on every
 * write, asserted unchanged as the "hasn't moved since scan" fence via `buildVersionedDelete`.
 */
import { buildVersionedDelete, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import { computeUploadSlotPurgeAfter } from "../../modules/document/domain/retention.js";
import type {
  TransientPurgeCandidate,
  TransientPurgeCandidateSource,
  TenantLifecycleStatusSource,
  UploadSlotPurgeCandidate,
  WebhookInboxPurgeCandidate,
} from "./candidate-source.js";

export const WEBHOOK_INBOX_RETENTION_DAYS = 7;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** ACTIVE-only fence (see file header) — same bare-string rationale as the other purge workers'
 * own constant. */
const TENANT_ACTIVE_STATUS = "ACTIVE";

export interface TransientPurgeDeps {
  candidates: TransientPurgeCandidateSource;
  lifecycle: TenantLifecycleStatusSource;
  tableName: string;
  now: () => string;
}

export interface TransientPurgeResult {
  scanned: number;
  purged: number;
  skippedTooRecent: number;
  skippedActiveUploadSlot: number;
  skippedTenantNotActive: number;
  skippedConcurrentlyModified: number;
}

/** Hard cap on pages drained per invocation — same rationale as the other purge workers'
 * `MAX_PAGES`: bounds a single invocation against a pathological backlog; anything beyond this is
 * picked up by the next scheduled run. */
const MAX_PAGES = 25;

export function isWebhookInboxPurgeEligible(createdAt: string, nowIso: string): boolean {
  const cutoffMs = Date.parse(createdAt) + WEBHOOK_INBOX_RETENTION_DAYS * MS_PER_DAY;
  return cutoffMs <= Date.parse(nowIso);
}

export function isUploadSlotPurgeEligible(candidate: Pick<UploadSlotPurgeCandidate, "status" | "reservedAt">, nowIso: string): boolean {
  if (candidate.status === "RESERVED") return false; // still an active reservation - never a candidate.
  const wasConfirmed = candidate.status === "CONSUMED";
  const purgeAfter = computeUploadSlotPurgeAfter(candidate.reservedAt, wasConfirmed);
  return Date.parse(purgeAfter) <= Date.parse(nowIso);
}

export async function runTransientPurge(deps: TransientPurgeDeps): Promise<TransientPurgeResult> {
  const result: TransientPurgeResult = {
    scanned: 0,
    purged: 0,
    skippedTooRecent: 0,
    skippedActiveUploadSlot: 0,
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

      if (!isEligibleByAge(candidate, nowIso, result)) continue;

      if (!(await tenantIsActive(candidate.tenantId))) {
        result.skippedTenantNotActive += 1;
        continue;
      }

      const del = buildVersionedDelete({
        tableName: deps.tableName,
        key: { PK: candidate.PK, SK: candidate.SK },
        tenantId: candidate.tenantId,
        expectedVersion: candidate.version,
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

function isEligibleByAge(candidate: TransientPurgeCandidate, nowIso: string, result: TransientPurgeResult): boolean {
  if (candidate.entityType === "WebhookInbox") {
    const eligible = isWebhookInboxPurgeEligible((candidate as WebhookInboxPurgeCandidate).createdAt, nowIso);
    if (!eligible) result.skippedTooRecent += 1;
    return eligible;
  }

  // UploadSlot.
  if (candidate.status === "RESERVED") {
    result.skippedActiveUploadSlot += 1;
    return false;
  }
  const eligible = isUploadSlotPurgeEligible(candidate, nowIso);
  if (!eligible) result.skippedTooRecent += 1;
  return eligible;
}
