import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiClient } from "../api/apiClient.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { ExpirationItem, ExpirationItemStatus } from "../api/types.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";

interface ItemSearchPage {
  items: { kind: "EXPIRATION_ITEM"; item: ExpirationItem }[];
  cursor: string | null;
  scanLimitReached: boolean;
}

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
    queryKey: [...queryKeys.items.dashboardAll(organizationId ?? ""), "search", status, search, validityState],
    queryFn: ({ signal, pageParam }) => {
      const params = new URLSearchParams({ status });
      if (search) params.set("namePrefix", search);
      if (validityState) params.set("validityState", validityState);
      if (pageParam) params.set("cursor", pageParam);
      return apiClient.get<ItemSearchPage>("/items/search?" + params.toString(), { signal });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.cursor ?? undefined,
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.OPERATIONAL,
    refetchOnWindowFocus: true,
  });
}
