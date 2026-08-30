import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { removeMember } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export interface RemoveMemberVariables {
  userId: string;
  expectedVersion: number;
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<void, RemoveMemberVariables>({
    mutationFn: ({ userId, expectedVersion }) => removeMember(userId, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(organizationId) });
    },
  });
}
