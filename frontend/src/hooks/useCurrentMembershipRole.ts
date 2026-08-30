import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useOrganizationsList } from "./useOrganizationsList.js";
import type { MembershipRole } from "../api/types.js";

/** The current user's own role in the active Organization (Wave B2B-10 "permission UX" scope
 * item) - looked up from `useOrganizationsList()` (which already carries `role` per
 * Organization, `UsableOrganization`) rather than a new backend field. `undefined` while
 * either query hasn't resolved yet.
 *
 * Frontend-side gating built on this value is convenience/UX only - it NEVER replaces
 * server-side `authorize()` (every mutation this app makes is independently re-checked by the
 * backend's own RBAC matrix; hiding a control here is not a security boundary). */
export function useCurrentMembershipRole(): MembershipRole | undefined {
  const { organizationId } = useActiveOrganization();
  const organizationsQuery = useOrganizationsList();
  if (!organizationId || !organizationsQuery.data) return undefined;
  return organizationsQuery.data.organizations.find((org) => org.organizationId === organizationId)?.role;
}
