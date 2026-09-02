/**
 * Narrow port for the SecurityAuditPurgeWorker (D-153, migrated to GSI8 by D-179/D-187 — 6th of 9
 * workers, mirrors the D-186 quota-telemetry-purge slice exactly for the poison-record/DLQ shape,
 * D-183's "no self-heal branch" reasoning for append-only rows). Replaces the base-table `Scan`
 * this worker used through D-186 with a `Query` against GSI8 (`GSI8PK=WORK#SECURITY_AUDIT`,
 * `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<entityType>#<sk>`, `KEYS_ONLY`) — closes the same
 * structural starvation D-170 confirmed for `Scan`+`Limit`.
 *
 * Covers the 4 `AuditEvent`-family entities (`AuditEvent`, `MembershipAuditEvent`,
 * `SubjectAuditEvent`, `TenantAuditEvent` — see `shared/security-audit-gsi8.ts`), the SAME 4
 * partitions `GET /activity`'s `ActivityService` k-way-merges. All 4 are append-only by
 * construction: the GSI8 pointer is written exactly once, at creation (each domain module's own
 * `build*Event()`), never refreshed — no terminal-state transition exists for an immutable row,
 * so unlike invitation-purge there is no obsolete-pointer self-heal branch needed here either
 * (same absence, same reasoning as D-186 quota-telemetry-purge, different underlying cause:
 * append-only vs. "every resetAt-changing write also refreshes the pointer").
 *
 * GSI8 is discovery-only, never a source of eligibility (D-179 §2/§4) — every candidate the Query
 * returns is revalidated with a consistent `getCandidate()` read before any write, and the write
 * itself (`transactWrite`) always re-asserts the facts it depends on atomically:
 *   - the row's own `occurredAt` (this entity family's OCC fence — no `version` counter exists,
 *     none of the 4 is ever updated after creation).
 *   - the owning tenant's `TenantLifecycleRecord.status = ACTIVE`, checked IN THE SAME
 *     `TransactWriteItems` as the delete.
 *
 * **`MembershipAuditEvent` normalization**: it declares `organizationId`, not `tenantId` — the
 * SAME value (its own `PK` uses the identical `TENANT#<organizationId>#...` prefix as every other
 * tenant-scoped partition) but a different field name. `GSI8SK` already embeds the normalized
 * `tenantId` (`securityAuditGsi8Keys()`'s caller passes `organizationId` under the `tenantId` key
 * at build time), so the GSI8 adapter never needs to special-case this entity when parsing a raw
 * `KEYS_ONLY` result row.
 */
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import type { SecurityAuditGsi8EntityType } from "../../shared/security-audit-gsi8.js";

export type SecurityAuditEntityType = SecurityAuditGsi8EntityType;

export interface SecurityAuditPurgeCandidate extends EntityKey {
  entityType: SecurityAuditEntityType;
  /** Normalized owner-tenant id — `organizationId` for `MembershipAuditEvent`, `tenantId` for
   * the other 3 (see file header). Always the real `TENANT#<id>#...` value from the row's own
   * PK, never re-derived. */
  tenantId: string;
  occurredAt: string;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

/** One `KEYS_ONLY` GSI8 result row — `tenantId`/`entityType` are parsed out of `GSI8SK` (embedded
 * in the sort key by `securityAuditGsi8Keys()` precisely so a `KEYS_ONLY` projection is enough to
 * build the tenant-ACTIVE `ConditionCheck` without a second read). */
export interface SecurityAuditGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
  entityType: SecurityAuditEntityType;
}

export interface SecurityAuditGsi8Page {
  items: SecurityAuditGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface SecurityAuditPurgeCandidateSource {
  /** `Query GSI8PK = "WORK#SECURITY_AUDIT" AND GSI8SK < :before`, ordered by due date. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<SecurityAuditGsi8Page>;
  /** Strongly-consistent read of the base row - the revalidation `getCandidate()` D-179 §4
   * requires before acting on any GSI8 candidate. `undefined` when the row is already gone
   * (idempotent no-op). */
  getCandidate(key: EntityKey): Promise<SecurityAuditPurgeCandidate | undefined>;
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
