import { useQuery } from "@tanstack/react-query";
import { fetchItem } from "../api/items.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { ItemResponse } from "../api/types.js";

export function useItem(itemId: string) {
  return useQuery<ItemResponse, unknown>({
    queryKey: ["items", "detail", itemId],
    queryFn: () => fetchItem(itemId),
    retry: retryPolicyFor("safe-read"),
    enabled: itemId.length > 0,
  });
}
