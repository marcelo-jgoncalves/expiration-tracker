import { useQuery } from "@tanstack/react-query";
import { fetchItem } from "../api/items.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { ItemResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useItem(itemId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<ItemResponse, unknown>({
    queryKey: queryKeys.items.detail(organizationId ?? "", itemId),
    queryFn: ({ signal }) => fetchItem(itemId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && itemId.length > 0,
  });
}
