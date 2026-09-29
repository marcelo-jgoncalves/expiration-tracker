import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { transferOwnership } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export interface TransferOwnershipVariables {
  userId: string;
  expectedCallerVersion: number;
  expectedTargetVersion: number;
}

/** D-348 - OCC-protected on BOTH sides of the transfer (the acting OWNER's own Membership
 * version, the target's Membership version) - a stale read on either side surfaces as a
 * conflict the caller must handle explicitly, same discipline as useChangeMemberRole/
 * useRemoveMember. Transferring ownership changes the ACTING user's own role too (OWNER->ADMIN),
 * so it invalidates the same members list query the role/remove mutations already do. */
export function useTransferOwnership() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<void, TransferOwnershipVariables>({
    mutationFn: ({ userId, expectedCallerVersion, expectedTargetVersion }) => transferOwnership(userId, expectedCallerVersion, expectedTargetVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(organizationId) });
    },
  });
}
