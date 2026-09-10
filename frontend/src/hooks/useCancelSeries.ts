/** A14 (Block 6, D-2xx) - "Cancelar" série (WRITE_ROLES, `docarchive:series-cancel`). OCC-fenced
 * (`useOccMutation`, same discipline as `useDeleteRequirement`). */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { cancelSeries } from "../api/documentRequests.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { DocumentRequestSeries } from "../api/types.js";

export function useCancelSeries(subjectId: string, seriesId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<{ series: DocumentRequestSeries }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => cancelSeries(subjectId, seriesId, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.series(organizationId, subjectId) });
    },
  });
}
