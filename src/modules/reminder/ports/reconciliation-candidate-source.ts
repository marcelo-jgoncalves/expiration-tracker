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

export interface ExpiredClaimCandidate {
  tenantId: string;
  occurrenceId: string;
  claimExpiresAt: string;
  version: number;
}

export interface DstReconciliationCandidate {
  tenantId: string;
  policyId: string;
  timeZone: string;
  windowStart: string;
  windowEnd: string;
}

export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface ReminderReconciliationCandidateSource {
  /** GSI6PK="WORKSTATE#CLAIMED" (global), GSI6SK=<claimExpiresAt>#TENANT#<tenantId>#OCCURRENCE#<occurrenceId>. */
  listExpiredClaims(input: { before: string; pageSize?: number; cursor?: string }): Promise<Page<ExpiredClaimCandidate>>;
  /** GSI6PK="WORKSTATE#DST_PENDING" (global), GSI6SK=<windowStart>#TENANT#<tenantId>#POLICY#<policyId>. */
  listDstCandidates(input: { window: { start: string; end: string }; pageSize?: number; cursor?: string }): Promise<Page<DstReconciliationCandidate>>;
}

export const GSI6PK_WORKSTATE_CLAIMED = "WORKSTATE#CLAIMED";
export const GSI6PK_WORKSTATE_DST_PENDING = "WORKSTATE#DST_PENDING";

export function buildExpiredClaimGsi6Sk(claimExpiresAt: string, tenantId: string, occurrenceId: string): string {
  return `${claimExpiresAt}#TENANT#${tenantId}#OCCURRENCE#${occurrenceId}`;
}

export function buildDstCandidateGsi6Sk(windowStart: string, tenantId: string, policyId: string): string {
  return `${windowStart}#TENANT#${tenantId}#POLICY#${policyId}`;
}
