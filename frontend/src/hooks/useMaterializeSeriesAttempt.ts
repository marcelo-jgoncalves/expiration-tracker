/** A14 (Block 6, D-2xx) - "Gerar agora" (WRITE_ROLES, `docarchive:series-materialize`). Touches
 * BOTH panels (the series' own `nextDueAt`/`latestAttemptIndex` AND a new row in "Solicitações
 * avulsas e materializações") - invalidates both keys explicitly, never relying on a shared key
 * (see `queryKeys.documentArchive.series`'s own doc comment on why they're independent). */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { materializeSeriesAttempt } from "../api/documentRequests.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { DocumentRequest, DocumentRequestSeries } from "../api/types.js";

export function useMaterializeSeriesAttempt(subjectId: string, seriesId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<{ series: DocumentRequestSeries; request: DocumentRequest }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => materializeSeriesAttempt(subjectId, seriesId, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.series(organizationId, subjectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.documentRequests(organizationId, subjectId) });
    },
  });
}
