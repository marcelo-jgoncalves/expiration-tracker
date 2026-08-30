import { useQuery } from "@tanstack/react-query";
import { fetchDocumentSubmissions } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DocumentSubmissionsResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** Only fetched once the operator actually expands a requirement to review it (`enabled`
 * gate below) - never prefetched for every MISSING assignment on the subject just to render
 * a list, matching the "no speculative reads" discipline the rest of this app already uses. */
export function useDocumentSubmissions(subjectId: string, assignmentId: string, enabled: boolean) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<DocumentSubmissionsResponse, unknown>({
    queryKey: queryKeys.subjects.submissions(organizationId ?? "", subjectId, assignmentId),
    queryFn: ({ signal }) => fetchDocumentSubmissions(subjectId, assignmentId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: enabled && Boolean(organizationId) && !switching && subjectId.length > 0 && assignmentId.length > 0,
  });
}
