import { useQuery } from "@tanstack/react-query";
import { fetchSubjectCompliance } from "../api/requirements.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { SubjectComplianceSummary } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A09 (Block 3, D-2xx) - Compliance panel loads independently of the destination-cards grid
 * (spec: a panel failure never blocks the rest of the hub). */
export function useSubjectCompliance(subjectId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ compliance: SubjectComplianceSummary }, unknown>({
    queryKey: queryKeys.documentArchive.subjectCompliance(organizationId ?? "", subjectId),
    queryFn: ({ signal }) => fetchSubjectCompliance(subjectId, { signal }),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0,
    retry: retryPolicyFor("safe-read"),
  });
}
