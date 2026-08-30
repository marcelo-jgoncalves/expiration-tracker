import { useQuery } from "@tanstack/react-query";
import { fetchSubjectsDashboard } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { SubjectsDashboardResponse, TrackedSubjectStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useSubjectsDashboard(status: TrackedSubjectStatus) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<SubjectsDashboardResponse, unknown>({
    queryKey: queryKeys.subjects.dashboard(organizationId ?? "", status),
    queryFn: ({ signal }) => fetchSubjectsDashboard(status, { signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
