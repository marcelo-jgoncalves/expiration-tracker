/**
 * Narrow port for the InvitationPurgeWorker (D-155, 2nd worker migrated to GSI8 — D-179/D-181
 * slice 2, mirroring the D-180 membership-purge pilot exactly). Replaces the base-table `Scan`
 * this worker used through D-181 with a `Query` against GSI8 (`GSI8PK=WORK#INVITATION_PURGE`,
 * `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<invitationId>`, `KEYS_ONLY`) — closes the same structural
 * starvation D-170 confirmed for `Scan`+`Limit`.
 *
 * GSI8 is discovery-only, never a source of eligibility (D-179 §2/§4) — every candidate the
 * Query returns is revalidated with a consistent `getInvitation()` read before any write, and the
 * write itself (`transactWrite`) always re-asserts the facts it depends on atomically:
 *   - the Invitation row's own `version` (OCC)
 *   - the owning tenant's `TenantLifecycleRecord.status = ACTIVE`, checked IN THE SAME
 *     `TransactWriteItems` as the delete.
 */
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import type { Invitation } from "../../modules/organization/domain/invitation.js";

export interface InvitationPurgeCandidate extends EntityKey {
  entityType: "Invitation";
  organizationId: string;
  invitationId: string;
  status: Invitation["status"];
  expiresAt: string;
  revokedAt?: string;
  version: number;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

/** One `KEYS_ONLY` GSI8 result row — `tenantId` is parsed out of `GSI8SK` (embedded in the sort
 * key by `invitationGsi8Keys()` precisely so a `KEYS_ONLY` projection is enough to build the
 * tenant-ACTIVE `ConditionCheck` without a second read). */
export interface InvitationGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
}

export interface InvitationGsi8Page {
  items: InvitationGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface InvitationPurgeCandidateSource {
  /** `Query GSI8PK = "WORK#INVITATION_PURGE" AND GSI8SK < :before`, ordered by due date. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<InvitationGsi8Page>;
  /** Strongly-consistent read of the base Invitation row — the revalidation `getInvitation()`
   * D-179 §4 requires before acting on any GSI8 candidate. `undefined` when the row is already
   * gone (idempotent no-op). */
  getInvitation(key: EntityKey): Promise<InvitationPurgeCandidate | undefined>;
  /** Real `TransactWriteItems` — used both for the claim/delete (ConditionCheck + Delete) and for
   * the poison-record backoff/DLQ move (a single conditioned Update). */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}
