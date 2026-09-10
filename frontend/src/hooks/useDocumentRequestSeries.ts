import { useQuery } from "@tanstack/react-query";
import { listSeries } from "../api/documentRequests.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { queryKeys } from "../api/queryKeys.js";
import type { DocumentRequestSeries } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A14 (Block 6, D-2xx) - "Séries recorrentes" panel, `docarchive:series-read` (all roles). */
export function useDocumentRequestSeries(subjectId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ series: DocumentRequestSeries[] }, unknown>({
    queryKey: queryKeys.documentArchive.series(organizationId ?? "", subjectId),
    queryFn: ({ signal }) => listSeries(subjectId, { signal }),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0,
    retry: retryPolicyFor("safe-read"),
  });
}
