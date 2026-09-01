/**
 * D-136/D-E (performance hot-path): the dashboard endpoint has two genuinely different
 * consumers - Overview wants a single small, always-fresh-enough bounded read; ItemsCollection
 * wants the full set, paginated, never a single unbounded response. They used to share one
 * query key/hook (`useItemsDashboard`), which the D-136/D-E protocol found was a real cache
 * collision risk once one side started passing `limit` and the other didn't. Split into two
 * hooks, two distinct query keys (queryKeys.items.dashboardBounded/dashboardPage) - both still
 * extend the same `dashboardAll(orgId)` prefix, so existing invalidations after create/renew
 * keep working against both without any call-site change.
 */
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { fetchDashboard } from "../api/items.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DashboardResponse, ExpirationItemStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

const OVERVIEW_LIMIT = 30;

/** Overview: one bounded page, no "load more" - the 30 nearest-due ACTIVE items is the entire
 * point of this screen (mission §29's attention summary), never a partial view of a larger list
 * the user is expected to page through. */
export function useItemsDashboardBounded(status: ExpirationItemStatus, limit: number = OVERVIEW_LIMIT) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<DashboardResponse, unknown>({
    queryKey: queryKeys.items.dashboardBounded(organizationId ?? "", status, limit),
    queryFn: ({ signal }) => fetchDashboard(status, { signal, limit }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}

/** ItemsCollection: real cursor pagination via TanStack Query's own `pageParam` - never fetches
 * more than one page ahead of what the user asked to see ("Carregar mais"), and never re-derives
 * "how many pages exist" from anything but the server's own `nextCursor`. */
export function useItemsDashboardPage(status: ExpirationItemStatus) {
  const { organizationId, switching } = useActiveOrganization();
  return useInfiniteQuery<DashboardResponse, unknown>({
    queryKey: queryKeys.items.dashboardPage(organizationId ?? "", status),
    queryFn: ({ signal, pageParam }) => fetchDashboard(status, { signal, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
