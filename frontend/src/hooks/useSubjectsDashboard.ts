import { useQuery } from "@tanstack/react-query";
import { fetchSubjectsDashboard } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { SubjectsDashboardResponse, TrackedSubjectStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

// PERF-10: OPERATIONAL - the dashboard reflects day-to-day subject tracking activity.
export function useSubjectsDashboard(status: TrackedSubjectStatus) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<SubjectsDashboardResponse, unknown>({
    queryKey: queryKeys.subjects.dashboard(organizationId ?? "", status),
    queryFn: ({ signal }) => fetchSubjectsDashboard(status, { signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
