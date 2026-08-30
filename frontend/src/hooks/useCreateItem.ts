import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { createItem } from "../api/items.js";
import { queryKeys } from "../api/queryKeys.js";
import type { CreateItemInput, ItemResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** Survives a session-interruption reload (mission §49) - the SAME key must back-to-back the
 * form draft it was generated for, so both are read together in CreateItem.tsx. */
export const CREATE_ITEM_IDEMPOTENCY_STORAGE_KEY = "expiration-tracker:create-item:idempotency-key";

export function useCreateItem() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useIdempotentMutation<ItemResponse, CreateItemInput>({
    persistenceKey: CREATE_ITEM_IDEMPOTENCY_STORAGE_KEY,
    mutationFn: (input, key) => createItem(input, key),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.items.dashboardAll(organizationId) });
    },
  });
}
