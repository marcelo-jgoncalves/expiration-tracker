/**
 * NotificationRecipientResolver (M4). Isolates candidate resolution/validation behind a port so
 * the router never re-implements eligibility rules itself.
 *
 * Round1 cross-critique (docs/architecture/reviews/m4-notification-engine-design/
 * round1-decisions-resolved.md §2): a naive fallback formula is NOT sufficient by itself -
 * `assigneeUserId` is an arbitrary, mutable, unvalidated string on ExpirationItem. Without
 * tenant-scoped validation here, a corrupted or cross-tenant `assigneeUserId` would let
 * notification content leak to a user outside the tenant. This resolver MUST confirm the
 * resolved user is active AND belongs to the same tenant - returning `undefined` (never a
 * silent fallback to some other user) when validation fails, which the router turns into
 * an auditable `RECIPIENT_NOT_FOUND`/`RECIPIENT_NOT_ELIGIBLE` cancellation.
 *
 * Wave B2B-11 (Responsibility + Notifications): the pre-B2B fallback here was
 * `assigneeUserId ?? tenantId` - valid only while the product was single-user-per-tenant
 * (`tenantId===userId`). Post-B2B, `tenantId` IS `organizationId`, never a real `userId` -
 * that fallback would resolve to a candidate that structurally can never be a real Membership,
 * always failing (fail-closed, but a dead/misleading rule, not a live fallback). Removed
 * entirely rather than replaced with a new default recipient (no external convergence on "who
 * gets notified with no assignee" - see the wave's scoping review - and inventing one is scope
 * beyond `roadmap-evolution/17` §116's "notification routing").
 */
export interface ResolvedRecipient {
  userId: string;
  tenantId: string;
  active: boolean;
  /** Wave B2B-13 (E2E/Adversarial Security, D-112): `GlobalUser.emailNormalized`, populated by
   * the same read this resolver already does for `active` - added so composition roots that
   * need to deliver an async notification (`runtime/aws/composition/notification.ts`'s
   * `resolveRecipientEmail`, `subject.ts`'s `resolveInternalUserEmail`) can reuse this resolver
   * instead of reading `GlobalUser` on their own, which is exactly the TOCTOU gap this wave
   * closed: a resolver read at delivery time (not just at routing time) that never re-checked
   * `Membership`/`GlobalUser.identityStatus`. Optional because it is meaningless when
   * `active` is `false` - callers must check `active` before reading it, never the reverse. This
   * resolver and `expiration/ports/member-eligibility.ts`'s `MemberEligibilityChecker` both
   * enforce the exact same rule (`Membership.status==="ACTIVE" &&
   * GlobalUser.identityStatus==="ACTIVE"`) against the same two entities - deliberately not
   * merged into one abstraction, since one resolves a recipient (with email) and the other
   * validates a candidate (boolean only, for watchers/assignees) - different enough shapes that
   * unifying them would obscure more than it would share. */
  email?: string;
}

export interface NotificationRecipientResolver {
  resolve(input: { tenantId: string; candidateUserId: string }): Promise<ResolvedRecipient | undefined>;
}

/** `assigneeUserId` if present and non-empty, else an empty string (no candidate at all - the
 * caller's own `candidateWasEmpty` check treats this as an immediate cancellation, never a call
 * to `resolve()` with a bogus candidate). The resolver (implementation, not this function) is
 * what enforces tenant membership/active-status; this only picks the CANDIDATE to validate. */
export function resolveCandidateUserId(input: { assigneeUserId?: string }): string {
  const assignee = input.assigneeUserId?.trim();
  return assignee && assignee.length > 0 ? assignee : "";
}
