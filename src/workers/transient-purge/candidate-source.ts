/**
 * Narrow port for the TransientPurgeWorker (D-156, migrated to GSI8 by D-179/D-188 — 7th of 9
 * workers). Replaces the base-table `Scan` this worker used through D-187 with a `Query` against
 * GSI8 (`GSI8PK=WORK#TRANSIENT`, `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>`,
 * `KEYS_ONLY`) — closes the same structural starvation D-170 confirmed for `Scan`+`Limit`.
 *
 * Covers the same two entities as before the migration — see `shared/transient-purge-gsi8.ts`'s
 * file header for the full investigation:
 *   - `WebhookInbox` — create-once/immutable, pointer written exactly once at creation
 *     (`ses-callback-workflow.ts`), same shape as `security-audit-purge`'s append-only rows.
 *   - `UploadSlot` — real status transitions. A `RESERVED` slot NEVER gets a GSI8 pointer (never
 *     a purge candidate); the pointer is written/refreshed atomically at each transition off
 *     RESERVED (`advance-after-evidence.ts`'s CONSUMED path, `upload-slot-reconciliation/
 *     reconciliation.ts`'s EXPIRED path) — same "pointer written per relevant transition"
 *     discipline as `invitation-purge` (D-182), not the simpler create-once shape.
 *
 * GSI8 is discovery-only, never a source of eligibility (D-179 §2/§4) — every candidate the
 * Query returns is revalidated with a consistent `getCandidate()` read before any write, and the
 * write itself (`transactWrite`) always re-asserts the facts it depends on atomically:
 *   - the row's own `version` (OCC) — BOTH entities carry a real version counter, unlike
 *     `security-audit-purge`'s append-only family.
 *   - the owning tenant's `TenantLifecycleRecord.status = ACTIVE`, checked IN THE SAME
 *     `TransactWriteItems` as the delete.
 */
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import type { UploadSlotStatus } from "../../modules/document/domain/upload-slot.js";
import type { TransientGsi8EntityType } from "../../shared/transient-purge-gsi8.js";

export interface WebhookInboxPurgeCandidate extends EntityKey {
  entityType: "WebhookInbox";
  tenantId: string;
  createdAt: string;
  version: number;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

export interface UploadSlotPurgeCandidate extends EntityKey {
  entityType: "UploadSlot";
  tenantId: string;
  reservedAt: string;
  status: UploadSlotStatus;
  version: number;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

export type TransientPurgeCandidate = WebhookInboxPurgeCandidate | UploadSlotPurgeCandidate;

/** One `KEYS_ONLY` GSI8 result row — `tenantId`/`entityType` are parsed out of `GSI8SK` (embedded
 * in the sort key by `transientPurgeGsi8Keys()` precisely so a `KEYS_ONLY` projection is enough to
 * build the tenant-ACTIVE `ConditionCheck` without a second read). */
export interface TransientGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
  entityType: TransientGsi8EntityType;
}

export interface TransientGsi8Page {
  items: TransientGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface TransientPurgeCandidateSource {
  /** `Query GSI8PK = "WORK#TRANSIENT" AND GSI8SK < :before`, ordered by due date. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<TransientGsi8Page>;
  /** Strongly-consistent read of the base row - the revalidation `getCandidate()` D-179 §4
   * requires before acting on any GSI8 candidate. `undefined` when the row is already gone
   * (idempotent no-op). */
  getCandidate(key: EntityKey): Promise<TransientPurgeCandidate | undefined>;
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
