import { useMutation, useQueryClient } from "@tanstack/react-query";
import { leaveOrganization } from "../api/members.js";
import { sessionQueryKey } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** Same cancel/invalidate shape as `ActiveOrganizationProvider`'s own `selectMutation` (Wave
 * B2B-10) - cancels in-flight org-scoped fetches for the organization being left BEFORE the
 * session flips, then invalidates the session query so `ActiveOrganizationProvider` picks up
 * whatever the backend resolves next (another organization, or none - `OnboardingGate` handles
 * both without this hook needing to know which). */
export function useLeaveOrganization() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<void, unknown, void>({
    mutationFn: () => leaveOrganization(),
    onMutate: async () => {
      if (organizationId) await queryClient.cancelQueries({ queryKey: ["org", organizationId], exact: false });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}
