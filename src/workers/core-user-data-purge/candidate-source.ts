/**
 * Narrow port for the CoreUserDataPurgeWorker (D-151, migrated to GSI8 by D-179/D-190 — 9th and
 * LAST of 9 workers, mirrors the D-179/D-18x delivery-record-purge slice for the poison-record/
 * DLQ shape, since this worker DOES have a tenant-ACTIVE fence AND a real `version` OCC counter
 * on both entities). Replaces the base-table `Scan` this worker used through D-189 with a `Query`
 * against GSI8 (`GSI8PK=WORK#CORE_USER_DATA`,
 * `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>`, `KEYS_ONLY`) — closes the same
 * structural starvation D-170 confirmed for `Scan`+`Limit`.
 *
 * Covers the 2 entities `ExpirationItem`/`ReminderPolicy` (see `shared/core-user-data-gsi8.ts`).
 * Unlike delivery-record-purge's fixed `createdAt` clock, eligibility here is gated on a
 * `deletedAt` TRANSITION — the pointer only exists once a row is soft-deleted (see the shared
 * module's doc comment, including the known pre-existing gap: `ReminderPolicy` has no live
 * write path setting `deletedAt` today, so in practice only `ExpirationItem` rows ever appear
 * under `WORK#CORE_USER_DATA`).
 *
 * GSI8 is discovery-only, never a source of eligibility (D-179 §2/§4) — every candidate the Query
 * returns is revalidated with a consistent `getCandidate()` read before any write, and the write
 * itself (`transactWrite`) always re-asserts the facts it depends on atomically:
 *   - the row's own `version` (real OCC counter both entities carry) AND `deletedAt` re-asserted
 *     EXACTLY as observed at revalidation time — this worker's single most important correctness
 *     property (task brief, carried forward unchanged from the pre-GSI8 `purge.ts`): a concurrent
 *     restore between revalidation and delete must fail the condition closed, never silently
 *     discard a live record.
 *   - the owning tenant's `TenantLifecycleRecord.status = ACTIVE`, checked IN THE SAME
 *     `TransactWriteItems` as the delete.
 */
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import type { CoreUserDataGsi8EntityType } from "../../shared/core-user-data-gsi8.js";

export type CoreUserDataEntityType = CoreUserDataGsi8EntityType;

export interface CoreUserDataPurgeCandidate extends EntityKey {
  entityType: CoreUserDataEntityType;
  tenantId: string;
  deletedAt: string;
  version: number;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

/** One `KEYS_ONLY` GSI8 result row — `tenantId`/`entityType` are parsed out of `GSI8SK` (embedded
 * in the sort key by `coreUserDataGsi8Keys()` precisely so a `KEYS_ONLY` projection is enough to
 * build the tenant-ACTIVE `ConditionCheck` without a second read). */
export interface CoreUserDataGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
  entityType: CoreUserDataEntityType;
}

export interface CoreUserDataGsi8Page {
  items: CoreUserDataGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface CoreUserDataPurgeCandidateSource {
  /** `Query GSI8PK = "WORK#CORE_USER_DATA" AND GSI8SK < :before`, ordered by due date. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<CoreUserDataGsi8Page>;
  /** Strongly-consistent read of the base row - the revalidation `getCandidate()` D-179 §4
   * requires before acting on any GSI8 candidate. `undefined` when the row is already gone
   * (idempotent no-op). */
  getCandidate(key: EntityKey): Promise<CoreUserDataPurgeCandidate | undefined>;
  /** Real `TransactWriteItems` — used both for the claim/delete (ConditionCheck + Delete) and for
   * the poison-record backoff/DLQ move (a single conditioned Update). */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as every other purge worker's `TenantLifecycleStatusSource` — a tenant
 * mid-closure is the tenant-purge pipeline's job, never this worker's. A missing lifecycle record
 * is treated as NOT eligible (fail-closed) — every tenant gets one at creation
 * (`create-organization.ts`).
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
