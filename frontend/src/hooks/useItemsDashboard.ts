import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "../api/items.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DashboardResponse, ExpirationItemStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useItemsDashboard(status: ExpirationItemStatus) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<DashboardResponse, unknown>({
    queryKey: queryKeys.items.dashboard(organizationId ?? "", status),
    queryFn: ({ signal }) => fetchDashboard(status, { signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
