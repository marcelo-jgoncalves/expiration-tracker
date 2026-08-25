import { useQuery } from "@tanstack/react-query";
import { fetchRequirementAssignments } from "../api/subjects.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { RequirementAssignmentsResponse } from "../api/types.js";

export function useRequirementAssignments(subjectId: string) {
  return useQuery<RequirementAssignmentsResponse, unknown>({
    queryKey: ["subjects", "requirements", subjectId],
    queryFn: () => fetchRequirementAssignments(subjectId),
    retry: retryPolicyFor("safe-read"),
    enabled: subjectId.length > 0,
  });
}
