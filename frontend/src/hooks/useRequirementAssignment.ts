import { useQuery } from "@tanstack/react-query";
import { fetchRequirementAssignment } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { RequirementAssignmentResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A10 (Block 7, D-2xx) - single-assignment detail (Snapshot + timeline page). */
export function useRequirementAssignment(subjectId: string, assignmentId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<RequirementAssignmentResponse, unknown>({
    queryKey: queryKeys.subjects.assignmentDetail(organizationId ?? "", subjectId, assignmentId),
    queryFn: ({ signal }) => fetchRequirementAssignment(subjectId, assignmentId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0 && assignmentId.length > 0,
  });
}
