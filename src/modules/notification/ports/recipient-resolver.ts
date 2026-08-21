/**
 * NotificationRecipientResolver (M4). Isolates the MVP fallback rule
 * `candidateUserId = item.assigneeUserId ?? tenantId` (valid only while the product remains
 * single-user-per-tenant, tenantId=userId) behind a port so the future multiuser
 * organization model can replace the implementation without touching the router.
 *
 * Round1 cross-critique (docs/architecture/reviews/m4-notification-engine-design/
 * round1-decisions-resolved.md §2): the naive fallback formula is NOT sufficient by itself -
 * `assigneeUserId` is an arbitrary, mutable, unvalidated string on ExpirationItem. Without
 * tenant-scoped validation here, a corrupted or cross-tenant `assigneeUserId` would let
 * notification content leak to a user outside the tenant. This resolver MUST confirm the
 * resolved user is active AND belongs to the same tenant - returning `undefined` (never a
 * silent fallback to the tenant owner) when validation fails, which the router turns into
 * an auditable `RECIPIENT_NOT_FOUND`/`RECIPIENT_NOT_ELIGIBLE` cancellation.
 */
export interface ResolvedRecipient {
  userId: string;
  tenantId: string;
  active: boolean;
}

export interface NotificationRecipientResolver {
  resolve(input: { tenantId: string; candidateUserId: string }): Promise<ResolvedRecipient | undefined>;
}

/** Pure MVP precedence rule - `assigneeUserId` if present and non-empty, else the tenant
 * owner. The resolver (implementation, not this function) is what enforces tenant
 * membership/active-status; this only picks the CANDIDATE to validate. */
export function resolveCandidateUserId(input: { tenantId: string; assigneeUserId?: string }): string {
  const assignee = input.assigneeUserId?.trim();
  return assignee && assignee.length > 0 ? assignee : input.tenantId;
}
