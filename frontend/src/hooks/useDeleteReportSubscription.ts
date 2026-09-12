import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { deleteReportSubscription } from "../api/reports.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A16 (Block 10, D-2xx) - "Remover" assinatura (`reports:subscription-manage`, ADMIN_ROLES).
 * OCC-fenced (`expectedVersion`), same discipline as `useDeleteRequirementAssignment`. */
export function useDeleteReportSubscription() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<void, { subscriptionId: string; expectedVersion: number }>({
    mutationFn: ({ subscriptionId, expectedVersion }) => deleteReportSubscription(subscriptionId, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.subscriptions(organizationId) });
    },
  });
}
