import { useQuery } from "@tanstack/react-query";
import { fetchSubjectsDashboard } from "../api/subjects.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { SubjectsDashboardResponse, TrackedSubjectStatus } from "../api/types.js";

export function useSubjectsDashboard(status: TrackedSubjectStatus) {
  return useQuery<SubjectsDashboardResponse, unknown>({
    queryKey: ["subjects", "dashboard", status],
    queryFn: () => fetchSubjectsDashboard(status),
    retry: retryPolicyFor("safe-read"),
  });
}
