import { useQuery } from "@tanstack/react-query";
import { listDocumentChasingOccurrences } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { DocumentChasingOccurrence } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** D-288 - A10 timeline's automated-reminder entries. Only fetched once a timeline entry is
 * actually rendered for a real documentRequestId (`enabled` gate below) - same "no speculative
 * reads" discipline as `useDocumentSubmissions`. */
export function useDocumentChasingOccurrences(subjectId: string, documentRequestId: string, enabled: boolean) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ occurrences: DocumentChasingOccurrence[] }, unknown>({
    queryKey: queryKeys.subjects.documentChasingOccurrences(organizationId ?? "", subjectId, documentRequestId),
    queryFn: ({ signal }) => listDocumentChasingOccurrences(subjectId, documentRequestId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: enabled && Boolean(organizationId) && !switching && subjectId.length > 0 && documentRequestId.length > 0,
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
