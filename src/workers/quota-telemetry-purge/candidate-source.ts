/**
 * Narrow port for the QuotaTelemetryPurgeWorker (D-154, `docs/architecture/reviews/
 * quarantine-retention-scoping/estado-final-consolidado.md` Prioridade 4 — `QUOTA_TELEMETRY` =
 * "quotas/métricas identificáveis, MembershipInviteRateLimitRecord" per `privacy-lgpd.md` §4 line
 * 44). Investigated (task brief) every rate-limit/quota-tracking entity in the codebase — 5
 * candidates: `MembershipInviteRateLimitRecord` (organization), `GuestRateLimitRecord`/
 * `InitialInviteRateLimitRecord` (subject), `DocumentArchiveGuestRateLimitRecord`
 * (document-archive), and `TenantQuotaRecord` (identity). 4 of the 5 — including the ONE named
 * explicitly in `privacy-lgpd.md` — already carry a `purgeAfterTtl` field wired to the main
 * table's native DynamoDB TTL (`infra/modules/dynamo-table/main.tf`), so their physical purge is
 * already resolved, same "already resolved" status as `TRANSIENT`'s `InvitationTokenPointer`
 * (`privacy-lgpd.md` line 42) — building a new worker for them would duplicate an existing
 * mechanism, not close a gap.
 *
 * `TenantQuotaRecord` (`src/modules/identity/application/quota.ts`) is the ONE candidate with NO
 * expiry mechanism at all: no `purgeAfterTtl` field, no TTL wiring, no other purge path — the only
 * genuinely-unresolved entity inside "quotas/métricas identificáveis" (the generic half of the
 * design doc's definition, distinct from the one named example which turned out already-resolved
 * per above). This worker's whole scope is this ONE entity.
 *
 * **Window-end field**: `resetAt` — the fixed-window token bucket's own field for when its
 * current window closes (`TenantQuotaService.consume()`'s `resetAt = now + windowSeconds`),
 * exactly the concept `privacy-lgpd.md`'s "fim da janela + 30 dias" names. No separate
 * `createdAt`/`windowStart` field exists or is needed — `resetAt` alone determines eligibility.
 *
 * **No `version` field** (same situation as `SECURITY_AUDIT`'s 4 entities, different reason):
 * `TenantQuotaRecord` uses direct `count`/`resetAt` optimistic fields re-asserted via
 * `ConditionExpression` on every write (`quota.ts`'s own `updateConditional`/`buildConditionalPut`
 * calls), never a `version` counter — so this worker's delete re-asserts `resetAt` itself (the
 * exact field its own eligibility check depends on) as the "unchanged since scan" fence, same
 * pattern as `SECURITY_AUDIT` re-asserting `occurredAt`.
 *
 * Same deliberate full-table `Scan` tradeoff as the other 3 purge workers' candidate sources
 * (filtered by `entityType = "TenantQuota"`, not a GSI6 worklist): this entity has no external
 * side-effect to protect with a claim state.
 */
import type { DynamoDeleteCommandInput, EntityKey } from "../../shared/dynamodb/occ.js";

export interface QuotaTelemetryPurgeCandidate extends EntityKey {
  entityType: "TenantQuota";
  tenantId: string;
  resetAt: string;
}

export interface QuotaTelemetryScanPage {
  items: QuotaTelemetryPurgeCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface QuotaTelemetryPurgeCandidateSource {
  /** `Scan` with `FilterExpression: entityType = :tenantQuota AND attribute_exists(resetAt)` —
   * see file header for the cost tradeoff this accepts. */
  scanCandidates(exclusiveStartKey?: Record<string, unknown>): Promise<QuotaTelemetryScanPage>;
  /** Single conditioned `DeleteItem` (`buildConditionalDelete`, not `buildVersionedDelete` — see
   * file header on why there is no `version` to check). Throws the SDK's real
   * `ConditionalCheckFailedException` (recognized via `occ.ts#isConditionalCheckFailed`) when the
   * condition doesn't hold. */
  deleteCandidate(input: DynamoDeleteCommandInput): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as the other 3 purge workers' `TenantLifecycleStatusSource` — a tenant
 * mid-closure is the tenant-purge pipeline's job, never this worker's. Deliberately the same
 * narrow shape (not re-exported/shared), mirroring the precedents' own choice to keep each purge
 * worker's port surface independently readable.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
