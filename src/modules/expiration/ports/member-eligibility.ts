/**
 * MemberEligibilityChecker — Wave B2B-11 (Responsibility + Notifications,
 * `docs/architecture/reviews/multi-user-b2b-wave-b2b11-scoping/`, Claude 9.2/Codex 9.2, 3 rounds).
 *
 * A narrow port in the CONSUMING module (`expiration`), not a direct import of `organization`'s
 * physical model (`membershipKey()` etc.) — the real implementation lives in the composition root
 * (`runtime/aws/composition/expiration.ts`), backed by `OrganizationStore`/`GlobalUserRepository`.
 * Closes 2 real gaps found by code reading, not hypothetical: `ItemWatchService.addWatcher` and
 * `ExpirationService`'s `assigneeUserId` both accepted an arbitrary `userId` string with zero
 * validation against real Organization membership before this wave.
 *
 * Eligibility requires BOTH conditions (Round 3 finding, Codex): a Membership `ACTIVE` in this
 * Organization is not sufficient by itself if the person's GLOBAL identity has since been
 * suspended (`GlobalUser.identityStatus`) - the same two-layer check
 * `resolve-request-context.ts` already applies for normal request authentication, extended here
 * to responsibility/notification eligibility.
 */
export interface MemberEligibilityChecker {
  isEligibleMember(organizationId: string, userId: string): Promise<boolean>;
}
