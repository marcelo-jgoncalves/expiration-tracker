import { useMutation, useQueryClient } from "@tanstack/react-query";
import { closeOrganization } from "../api/members.js";
import { sessionQueryKey } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** W3-07 (D-124). Same cancel/invalidate shape as `useLeaveOrganization` - once the closure is
 * accepted the organization stops being usable (its `TenantLifecycleRecord` leaves ACTIVE, and
 * the ACTIVE-only fence rejects every subsequent business mutation), so in-flight org-scoped
 * fetches are cancelled and the session query is invalidated to let `ActiveOrganizationProvider`
 * resolve whatever context remains. */
export function useCloseOrganization() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<{ organizationId: string; status: string }, unknown, string>({
    mutationFn: (confirmOrganizationId: string) => closeOrganization(confirmOrganizationId),
    onMutate: async () => {
      if (organizationId) await queryClient.cancelQueries({ queryKey: ["org", organizationId], exact: false });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}
