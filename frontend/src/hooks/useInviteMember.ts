import { useMutation, useQueryClient } from "@tanstack/react-query";
import { inviteMember } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import type { MembershipRole } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export interface InviteMemberVariables {
  email: string;
  role: MembershipRole;
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation({
    mutationFn: ({ email, role }: InviteMemberVariables) => inviteMember(email, role),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.invitations(organizationId) });
    },
  });
}
