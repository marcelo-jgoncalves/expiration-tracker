import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "../api/items.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DashboardResponse, ExpirationItemStatus } from "../api/types.js";

export function useItemsDashboard(status: ExpirationItemStatus) {
  return useQuery<DashboardResponse, unknown>({
    queryKey: ["items", "dashboard", status],
    queryFn: () => fetchDashboard(status),
    retry: retryPolicyFor("safe-read"),
  });
}
