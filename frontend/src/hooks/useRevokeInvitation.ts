import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revokeInvitation } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(invitationId),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.invitations(organizationId) });
    },
  });
}
