import { useQuery } from "@tanstack/react-query";
import { listLegacyDocumentRequests } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { LegacyDocumentRequest } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A10 (Block 7, D-2xx) - full request history for one assignment, feeds the timeline. */
export function useLegacyDocumentRequests(subjectId: string, assignmentId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ requests: LegacyDocumentRequest[] }, unknown>({
    queryKey: queryKeys.subjects.legacyDocumentRequests(organizationId ?? "", subjectId, assignmentId),
    queryFn: ({ signal }) => listLegacyDocumentRequests(subjectId, assignmentId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0 && assignmentId.length > 0,
  });
}
