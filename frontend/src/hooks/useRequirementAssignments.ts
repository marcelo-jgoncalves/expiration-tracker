import { useQuery } from "@tanstack/react-query";
import { fetchRequirementAssignments } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { RequirementAssignmentsResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useRequirementAssignments(subjectId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<RequirementAssignmentsResponse, unknown>({
    queryKey: queryKeys.subjects.requirements(organizationId ?? "", subjectId),
    queryFn: ({ signal }) => fetchRequirementAssignments(subjectId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0,
  });
}
