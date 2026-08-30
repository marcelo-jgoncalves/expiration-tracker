import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { renewItem } from "../api/items.js";
import { queryKeys } from "../api/queryKeys.js";
import type { RenewItemInput, RenewItemResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export interface RenewVariables extends RenewItemInput {
  /** If-Match - read from the currently-loaded item's `version` at submit time (mission §40:
   * after an OCC-conflict reload, the next attempt must use the freshly-fetched version, never
   * a value captured once at mount). */
  expectedVersion: number;
}

export function useRenewItem(itemId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useIdempotentMutation<RenewItemResponse, RenewVariables>({
    persistenceKey: `expiration-tracker:renew-item:${itemId}:idempotency-key`,
    mutationFn: ({ expectedVersion, ...input }, key) => renewItem(itemId, input, expectedVersion, key),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.dashboardAll(organizationId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(organizationId, itemId) });
    },
  });
}
