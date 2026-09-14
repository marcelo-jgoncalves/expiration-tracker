import { useQuery } from "@tanstack/react-query";
import { fetchItem } from "../api/items.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { ItemResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

// PERF-10: OPERATIONAL - item detail (renewal status etc.) changes with routine business use.
export function useItem(itemId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<ItemResponse, unknown>({
    queryKey: queryKeys.items.detail(organizationId ?? "", itemId),
    queryFn: ({ signal }) => fetchItem(itemId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && itemId.length > 0,
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
