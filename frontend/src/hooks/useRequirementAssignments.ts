import { useQuery } from "@tanstack/react-query";
import { fetchRequirementAssignments } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { RequirementAssignmentsResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

// PERF-10: OPERATIONAL - this list is the working set a MEMBER/reviewer actively manages
// (assign/link/unlink happen routinely), so it uses a short cache window rather than REFERENCE.
export function useRequirementAssignments(subjectId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<RequirementAssignmentsResponse, unknown>({
    queryKey: queryKeys.subjects.requirements(organizationId ?? "", subjectId),
    queryFn: ({ signal }) => fetchRequirementAssignments(subjectId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0,
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
