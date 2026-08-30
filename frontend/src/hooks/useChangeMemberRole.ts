import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { changeMemberRole } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import type { MembershipRole } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export interface ChangeMemberRoleVariables {
  userId: string;
  role: MembershipRole;
  expectedVersion: number;
}

/** OCC-protected (mission §16/§31, same discipline as useLinkExpirationItem) - a stale
 * expectedVersion (someone else already changed this member's role/status) surfaces as a
 * conflict the caller must handle explicitly, never a silent overwrite. */
export function useChangeMemberRole() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<void, ChangeMemberRoleVariables>({
    mutationFn: ({ userId, role, expectedVersion }) => changeMemberRole(userId, role, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(organizationId) });
    },
  });
}
