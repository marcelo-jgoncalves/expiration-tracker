import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { searchItems } from "../api/items.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { ExpirationItemStatus } from "../api/types.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";

export function useDebouncedValue(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export function useItemSearch(status: ExpirationItemStatus, search = "", validityState = "") {
  const { organizationId, switching } = useActiveOrganization();
  return useInfiniteQuery({
    queryKey: queryKeys.items.search(organizationId ?? "", status, search, validityState),
    queryFn: ({ signal, pageParam }) => searchItems(status, search, validityState, { signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.cursor ?? undefined,
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.OPERATIONAL,
    refetchOnWindowFocus: true,
  });
}
