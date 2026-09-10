/** A14 (Block 6, D-2xx) - "Editar" série (recipient only - see SubjectRequests.tsx's header
 * comment for why the cadence itself is not editable: `updateSeriesCadence` does not exist on the
 * backend). WRITE_ROLES, `docarchive:series-update` (D-230). */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateSeriesRecipient } from "../api/documentRequests.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { DocumentRequestSeries } from "../api/types.js";

export function useUpdateSeriesRecipient(subjectId: string, seriesId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<{ series: DocumentRequestSeries }, { recipientEmail: string | null; expectedVersion: number }>({
    mutationFn: ({ recipientEmail, expectedVersion }) => updateSeriesRecipient(subjectId, seriesId, recipientEmail, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.series(organizationId, subjectId) });
    },
  });
}
