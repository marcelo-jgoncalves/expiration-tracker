import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchActivity } from "../api/activity.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { ActivityPageResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** D-149: real cursor pagination via TanStack Query's own `pageParam`, same convention as
 * useItemsDashboardPage - never fetches more than one page ahead of "Carregar mais". */
export function useActivity(filters: { month?: string; resourceType?: string; enabled: boolean }) {
  const { organizationId, switching } = useActiveOrganization();
  return useInfiniteQuery<ActivityPageResponse, unknown>({
    queryKey: queryKeys.activity.page(organizationId ?? "", filters.month, filters.resourceType),
    queryFn: ({ signal, pageParam }) =>
      fetchActivity({ signal, month: filters.month, resourceType: filters.resourceType, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.cursor ?? undefined,
    // D-149: never fires the request while the role check hasn't (yet, or ever) cleared -
    // avoids a wasted round trip that the backend would just 403 anyway (ActivityLog.tsx's
    // gate is UX only, but there's no reason to spend the network call on a denied view).
    enabled: Boolean(organizationId) && !switching && filters.enabled,
    retry: retryPolicyFor("safe-read"),
  });
}
