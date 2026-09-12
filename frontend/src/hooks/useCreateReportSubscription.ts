import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createReportSubscription } from "../api/reports.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateReportSubscriptionInput, ReportSubscription } from "../api/types.js";

/** A16 (Block 10, D-2xx) - "Nova assinatura" (`reports:subscription-manage`, ADMIN_ROLES). No
 * idempotency-key contract on the backend (`createSubscription` in
 * `report-subscription-service.ts` takes none), same reasoning as `useAssignRequirement`. */
export function useCreateReportSubscription() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<{ subscription: ReportSubscription }, unknown, CreateReportSubscriptionInput>({
    mutationFn: (input) => createReportSubscription(input),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.reports.subscriptions(organizationId) });
    },
  });
}
