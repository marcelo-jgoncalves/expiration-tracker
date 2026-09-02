/**
 * Narrow port for the QuotaTelemetryPurgeWorker (D-154, widened to `EphemeralTelemetryMutation`
 * by D-136 D-D, migrated to GSI8 by D-179/D-186 — 5th of 9 workers, mirrors the D-180
 * membership-purge pilot / D-182 invitation-purge slice exactly). Replaces the base-table `Scan`
 * this worker used through D-185 with a `Query` against GSI8 (`GSI8PK=WORK#QUOTA_TELEMETRY`,
 * `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>`, `KEYS_ONLY`) — closes the same
 * structural starvation D-170 confirmed for `Scan`+`Limit`.
 *
 * GSI8 is discovery-only, never a source of eligibility (D-179 §2/§4) — every candidate the
 * Query returns is revalidated with a consistent `getCandidate()` read before any write, and the
 * write itself (`transactWrite`) always re-asserts the facts it depends on atomically:
 *   - the row's own `resetAt` (this entity's OCC fence — no `version` counter exists, see
 *     `quota.ts`'s `TenantQuotaRecord`/`EphemeralTelemetryRecord` docstrings)
 *   - the owning tenant's `TenantLifecycleRecord.status = ACTIVE`, checked IN THE SAME
 *     `TransactWriteItems` as the delete.
 */
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";

export type QuotaTelemetryEntityType = "TenantQuota" | "EphemeralTelemetryMutation";

export interface QuotaTelemetryPurgeCandidate extends EntityKey {
  entityType: QuotaTelemetryEntityType;
  tenantId: string;
  resetAt: string;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

/** One `KEYS_ONLY` GSI8 result row — `tenantId` is parsed out of `GSI8SK` (embedded in the sort
 * key by `quotaTelemetryGsi8Keys()` precisely so a `KEYS_ONLY` projection is enough to build the
 * tenant-ACTIVE `ConditionCheck` without a second read). */
export interface QuotaTelemetryGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
}

export interface QuotaTelemetryGsi8Page {
  items: QuotaTelemetryGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface QuotaTelemetryPurgeCandidateSource {
  /** `Query GSI8PK = "WORK#QUOTA_TELEMETRY" AND GSI8SK < :before`, ordered by due date. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<QuotaTelemetryGsi8Page>;
  /** Strongly-consistent read of the base row - the revalidation `getCandidate()` D-179 §4
   * requires before acting on any GSI8 candidate. `undefined` when the row is already gone
   * (idempotent no-op). */
  getCandidate(key: EntityKey): Promise<QuotaTelemetryPurgeCandidate | undefined>;
  /** Real `TransactWriteItems` — used both for the claim/delete (ConditionCheck + Delete) and for
   * the poison-record backoff/DLQ move (a single conditioned Update). */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}
