/**
 * Narrow port for the DeliveryRecordPurgeWorker (D-152, migrated to GSI8 by D-179/D-18x — 8th of
 * 9 workers, mirrors the D-187 security-audit-purge slice for the poison-record/DLQ shape, since
 * this worker DOES have a tenant-ACTIVE fence). Replaces the base-table `Scan` this worker used
 * through D-188 with a `Query` against GSI8 (`GSI8PK=WORK#DELIVERY_RECORD`,
 * `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>`, `KEYS_ONLY`) — closes the same
 * structural starvation D-170 confirmed for `Scan`+`Limit`.
 *
 * Covers the 2 entities `NotificationIntent`/`NotificationAttempt` (see
 * `shared/delivery-record-gsi8.ts`). Both are never updated after creation in practice — the
 * GSI8 pointer is written exactly once, at creation (each of the 3 real write sites), never
 * refreshed — no terminal-state transition exists, so like security-audit-purge there is no
 * obsolete-pointer self-heal branch needed here.
 *
 * GSI8 is discovery-only, never a source of eligibility (D-179 §2/§4) — every candidate the Query
 * returns is revalidated with a consistent `getCandidate()` read before any write, and the write
 * itself (`transactWrite`) always re-asserts the facts it depends on atomically:
 *   - the row's own `version` (real OCC counter both entities carry, unlike security-audit-purge's
 *     4 entities) AND `createdAt` re-asserted as defense-in-depth (same reasoning as this
 *     worker's pre-GSI8 `purge.ts`: nothing mutates `createdAt` today, but the condition makes it
 *     structural rather than merely true because nothing currently writes it).
 *   - the owning tenant's `TenantLifecycleRecord.status = ACTIVE`, checked IN THE SAME
 *     `TransactWriteItems` as the delete.
 *
 * **Known, accepted, out-of-scope gap (D-152, unchanged by this migration)**:
 * `NotificationAttemptLookup` (`PK=TENANT#<tenantId>#ATTEMPT#<attemptId>`, a derived pointer) is
 * NOT purged by this worker and becomes orphaned after a `NotificationAttempt` is deleted — this
 * migration does not fix that gap, only moves candidate discovery from `Scan` to GSI8.
 */
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import type { DeliveryRecordGsi8EntityType } from "../../shared/delivery-record-gsi8.js";

export type DeliveryRecordEntityType = DeliveryRecordGsi8EntityType;

export interface DeliveryRecordPurgeCandidate extends EntityKey {
  entityType: DeliveryRecordEntityType;
  tenantId: string;
  createdAt: string;
  version: number;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

/** One `KEYS_ONLY` GSI8 result row — `tenantId`/`entityType` are parsed out of `GSI8SK` (embedded
 * in the sort key by `deliveryRecordGsi8Keys()` precisely so a `KEYS_ONLY` projection is enough to
 * build the tenant-ACTIVE `ConditionCheck` without a second read). */
export interface DeliveryRecordGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
  entityType: DeliveryRecordEntityType;
}

export interface DeliveryRecordGsi8Page {
  items: DeliveryRecordGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface DeliveryRecordPurgeCandidateSource {
  /** `Query GSI8PK = "WORK#DELIVERY_RECORD" AND GSI8SK < :before`, ordered by due date. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<DeliveryRecordGsi8Page>;
  /** Strongly-consistent read of the base row - the revalidation `getCandidate()` D-179 §4
   * requires before acting on any GSI8 candidate. `undefined` when the row is already gone
   * (idempotent no-op). */
  getCandidate(key: EntityKey): Promise<DeliveryRecordPurgeCandidate | undefined>;
  /** Real `TransactWriteItems` — used both for the claim/delete (ConditionCheck + Delete) and for
   * the poison-record backoff/DLQ move (a single conditioned Update). */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

/**
 * Same ACTIVE-tenant fence as every other purge worker's `TenantLifecycleStatusSource` — a tenant
 * mid-closure is the tenant-purge pipeline's job, never this worker's.
 */
export interface TenantLifecycleStatusSource {
  getStatus(tenantId: string): Promise<string | undefined>;
}
