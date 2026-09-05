/**
 * TenantManagerLookup — D-201 (MANAGER escalation). A narrow port in the CONSUMING module
 * (`reminder`), same pattern as `expiration/ports/member-eligibility.ts` (Wave B2B-11): the
 * real implementation lives in the composition root, backed by `Membership`/`GlobalUser`,
 * never a direct import of `organization`'s physical model from `src/workers/`/
 * `src/modules/reminder/`/`src/modules/notification/`.
 *
 * A "manager" is a real RBAC role, never a separate configured list: `Membership` `ACTIVE`
 * with `role` `OWNER` or `ADMIN`, AND `GlobalUser.identityStatus` `ACTIVE` - the same 2-layer
 * eligibility bar `MemberEligibilityChecker.isEligibleMember` already enforces for every other
 * notification-eligible candidate in this codebase.
 */
export interface TenantManagerLookup {
  /** Every eligible manager for a tenant - the dispatch-time fan-out source. Never returns
   * more than `MAX_MANAGER_ESCALATION_RECIPIENTS` (dispatch.ts) - the composition root itself
   * does not cap; capping/truncation is dispatch's own transactional-budget concern. */
  listActiveManagers(tenantId: string): Promise<{ userId: string }[]>;
  /** Single-candidate re-check at routing time - never trusts the value an intent was created
   * with (a manager could have been demoted/removed between dispatch and routing). */
  isActiveManager(tenantId: string, userId: string): Promise<boolean>;
}
