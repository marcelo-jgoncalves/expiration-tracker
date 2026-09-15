/**
 * Narrow port for the ReminderReconciliation worker (M3.5, docs/architecture/m3.5-runtime-design.md
 * "Reconciliação: precisa de fonte real de candidatos"). Deliberately SEPARATE from
 * ReminderStore - same isolation principle that split ReminderProducerStore off in M3: a
 * query surface that only a privileged, non-tenant-facing worker needs shouldn't be
 * reachable from tenant-facing code.
 *
 * Backed by GSI6 with GLOBAL (non-tenant-prefixed) partition keys - same structural
 * exception as GSI3 (data-model.md §3), for the same reason: the reconciliation job doesn't
 * know a priori which tenants have an expired claim or a DST candidate. `tenantId` is
 * preserved in GSI6SK for context reconstruction. Exactly two IAM roles may query GSI6:
 * ReminderReconciliation (this port) and OutboxSweeperReminderDispatch (RECON#OUTBOX#PENDING,
 * shared/outbox) - see infra/lib/dynamo-table.ts `grantGsi6ReadTo`.
 */

/** GSI6 has ALL projection (unlike GSI3's KEYS_ONLY) - a queried row already IS the full
 * ReminderOccurrence item (PK/SK/status/claimExpiresAt/version/...), so the candidate type
 * is intentionally the same shape rather than a stripped-down reference: no extra
 * store.get roundtrip is needed to act on a claim-expiry candidate. */
export type ExpiredClaimCandidate = Record<string, unknown> & {
  PK: string;
  SK: string;
  tenantId: string;
  occurrenceId: string;
  claimExpiresAt: string;
  version: number;
  status: string;
};

/** Same ALL-projection reasoning as ExpiredClaimCandidate: the DST_PENDING pointer is
 * written on the ReminderOccurrence row itself (by ReminderMaterializer, when a materialized
 * occurrence's schedule crosses a known DST transition), not on the ReminderPolicy - a
 * (occurrence, policy) pair is what needs re-evaluating, and the occurrence row already
 * carries itemId/policyId/itemVersion/policyVersion needed to resolve the full pair. */
export type DstReconciliationCandidate = Record<string, unknown> & {
  PK: string;
  SK: string;
  tenantId: string;
  itemId: string;
  policyId: string;
};

/**
 * D-300 (`reminder-producer-implementation-plan-scoping/DECISION.md` §7): same ALL-projection
 * reasoning as the two candidate types above - a queried row already IS the full
 * `ReminderScanLease` item (PK/SK/ownerToken/leaseUntil/version/pagesProcessed/
 * candidatesPublished/...), so reconciliation's SCANLEASE pass can act on it (reclaim) without
 * an extra round trip. Kept as its OWN plain type here (not imported from
 * `workers/reminder-scan/lease.ts`'s `ReminderScanLease`) so this port module has no dependency
 * on that worker - `workers/reminder-scan/lease.ts` imports FROM this port
 * (`GSI6PK_SCANLEASE_IN_PROGRESS`), never the reverse, same direction every other constant in
 * this file already establishes.
 */
export type StuckScanLeaseCandidate = Record<string, unknown> & {
  PK: string;
  SK: string;
  ownerToken: string;
  leaseUntil: string;
  version: number;
  status: string;
};

export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface ReminderReconciliationCandidateSource {
  /** GSI6PK="WORKSTATE#CLAIMED" (global), GSI6SK=<claimExpiresAt>#TENANT#<tenantId>#OCCURRENCE#<occurrenceId>. */
  listExpiredClaims(input: { before: string; pageSize?: number; cursor?: string }): Promise<Page<ExpiredClaimCandidate>>;
  /** GSI6PK="WORKSTATE#DST_PENDING" (global), GSI6SK=<windowStart>#TENANT#<tenantId>#OCCURRENCE#<occurrenceId>. */
  listDstCandidates(input: { window: { start: string; end: string }; pageSize?: number; cursor?: string }): Promise<Page<DstReconciliationCandidate>>;
  /** D-300 (DECISION.md §7): GSI6PK="SCANLEASE#IN_PROGRESS" (global), GSI6SK=<leaseUntil>#<shardFnVersion>#<shardId>#<minuteISO>
   * - lexicographically ordered by leaseUntil first, so "before" (an ISO instant) is a genuine
   * range condition (GSI6SK < before), same mechanism `listExpiredClaims` already uses (its
   * GSI6SK is also leaseUntil/claimExpiresAt-prefixed for the exact same reason). Finds any
   * ReminderScanLease still IN_PROGRESS past its own leaseUntil - independent detection of a
   * stuck scan chain that works even after the producer's own lookback window, closing the gap
   * the plain per-tick enumeration (enumerate-and-lease.ts) cannot: that worker only re-examines
   * the CURRENT lookback window of minutes, never a (shard, minute) that has aged out of it. */
  listStuckScanLeases(input: { before: string; pageSize?: number; cursor?: string }): Promise<Page<StuckScanLeaseCandidate>>;
}

export const GSI6PK_WORKSTATE_CLAIMED = "WORKSTATE#CLAIMED";
export const GSI6PK_WORKSTATE_DST_PENDING = "WORKSTATE#DST_PENDING";
/** D-300 (DECISION.md §2/§7): single source of truth - `workers/reminder-scan/lease.ts` imports
 * this constant rather than declaring its own copy (same "ports own the constant, workers import
 * it" direction as the two constants above). */
export const GSI6PK_SCANLEASE_IN_PROGRESS = "SCANLEASE#IN_PROGRESS";

export function buildExpiredClaimGsi6Sk(claimExpiresAt: string, tenantId: string, occurrenceId: string): string {
  return `${claimExpiresAt}#TENANT#${tenantId}#OCCURRENCE#${occurrenceId}`;
}

export function buildDstCandidateGsi6Sk(windowStart: string, tenantId: string, occurrenceId: string): string {
  return `${windowStart}#TENANT#${tenantId}#OCCURRENCE#${occurrenceId}`;
}
