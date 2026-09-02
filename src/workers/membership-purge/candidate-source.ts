/**
 * Narrow port for the MembershipPurgeWorker (D-127 Prioridade 5, `Membership` leg — now the
 * D-179/D-180 pilot slice for MaintenanceDueIndex). Replaces the base-table `Scan` this worker
 * used through D-169 with a `Query` against the new global GSI8 (`GSI8PK=WORK#MEMBERSHIP_PURGE`,
 * `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<membershipId>`, `KEYS_ONLY`) — closes the structural
 * starvation D-170 confirmed (candidates past a bounded page cap were never reprocessed, since
 * `Scan`+`Limit` restarts from the same physical hash order every scheduled invocation).
 *
 * GSI8 is discovery-only, never a source of eligibility (D-179 §2/§4) — every candidate the
 * Query returns is revalidated with a consistent `getMembership()` read before any write, and the
 * write itself (`transactWrite`) always re-asserts the facts it depends on atomically:
 *   - the Membership row's own `version` (OCC, same discipline as every other write in this repo)
 *   - the owning tenant's `TenantLifecycleRecord.status = ACTIVE`, checked IN THE SAME
 *     `TransactWriteItems` as the delete — closes the TOCTOU the pre-D-179 worker had (a separate
 *     `GetItem` on the lifecycle record, cached per run, read strictly before the delete).
 */
import type { EntityKey, TransactWriteEntry } from "../../shared/dynamodb/occ.js";
import type { Membership } from "../../modules/organization/domain/membership.js";

export interface MembershipPurgeCandidate extends EntityKey {
  entityType: "Membership";
  organizationId: string;
  membershipId: string;
  status: Membership["status"];
  removedAt?: string;
  version: number;
  maintenanceAttemptCount?: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

/** One `KEYS_ONLY` GSI8 result row — `tenantId` is parsed out of `GSI8SK` (embedded in the sort
 * key by `membershipGsi8Keys()` precisely so a `KEYS_ONLY` projection is enough to build the
 * tenant-ACTIVE `ConditionCheck` without a second read). */
export interface MembershipGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
}

export interface MembershipGsi8Page {
  items: MembershipGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface MembershipPurgeCandidateSource {
  /** `Query GSI8PK = "WORK#MEMBERSHIP_PURGE" AND GSI8SK < :before`, ordered by due date — the
   * structural replacement for the old `Scan`+`Limit` (D-170 achado #5). */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<MembershipGsi8Page>;
  /** Strongly-consistent read of the base Membership row — the revalidation `getMembership()`
   * D-179 §4 requires before acting on any GSI8 candidate. `undefined` when the row is already
   * gone (a prior run, or this same run's earlier page, already purged it — idempotent no-op). */
  getMembership(key: EntityKey): Promise<MembershipPurgeCandidate | undefined>;
  /** Real `TransactWriteItems` — used both for the claim/delete (ConditionCheck + Delete) and for
   * the poison-record backoff/DLQ move (a single conditioned Update). `isTransactionCanceled`/
   * `getCancellationReasonCodes` (`shared/dynamodb/occ.ts`) let `purge.ts` distinguish which
   * entry's condition failed without depending on the AWS SDK type here. */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}
