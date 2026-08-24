import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { renewItem } from "../api/items.js";
import type { ItemResponse, RenewItemInput } from "../api/types.js";

export interface RenewVariables extends RenewItemInput {
  /** If-Match - read from the currently-loaded item's `version` at submit time (mission §40:
   * after an OCC-conflict reload, the next attempt must use the freshly-fetched version, never
   * a value captured once at mount). */
  expectedVersion: number;
}

export function useRenewItem(itemId: string) {
  const queryClient = useQueryClient();
  return useIdempotentMutation<ItemResponse, RenewVariables>({
    persistenceKey: `expiration-tracker:renew-item:${itemId}:idempotency-key`,
    mutationFn: ({ expectedVersion, ...input }, key) => renewItem(itemId, input, expectedVersion, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["items", "dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["items", "detail", itemId] });
    },
  });
}
