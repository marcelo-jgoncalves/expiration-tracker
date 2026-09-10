import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { createPolicy, updatePolicy } from "../api/reminderPolicy.js";
import { queryKeys } from "../api/queryKeys.js";
import type { ItemReminderPolicyResponse, PolicyResponse, PutPolicyInput } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

interface SaveVariables {
  input: PutPolicyInput;
  /** Present -> PUT (update the existing policy, OCC-guarded); absent -> POST (first save for
   * this item, A06's "no policy yet" state). */
  existingPolicyId?: string;
  expectedVersion?: number;
}

/** A06 (Block 2 D-258) - one hook for the screen's single "Salvar lembretes" action, covering
 * both create-on-first-save and update-on-subsequent-saves (the spec draws no UI distinction
 * between them - `:policyId` being absent is what decides which HTTP call happens). Toggling
 * "Política ativa" is just `enabled` inside the same PutPolicyInput, not a separate endpoint
 * call - `POST .../disable` exists for other callers but this screen's single Save action
 * covers the exact same effect via `updatePolicy`.
 *
 * Codex review finding (D-258 round 1): `invalidateQueries` alone leaves a real window open
 * between a successful save and the refetch actually landing - a second save started in that
 * window would still see the OLD `existingPolicyId`/`expectedVersion` (stale create-vs-update
 * dispatch, or an artificial OCC conflict). `onSuccess` now writes the mutation's own response
 * into the cache SYNCHRONOUSLY via `setQueryData` (the response already carries the new
 * `policyId`/`version`) before also invalidating for eventual consistency with the server. */
export function useSaveReminderPolicy(itemId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useIdempotentMutation<PolicyResponse, SaveVariables>({
    mutationFn: ({ input, existingPolicyId, expectedVersion }, idempotencyKey) =>
      existingPolicyId && expectedVersion !== undefined
        ? updatePolicy(existingPolicyId, input, expectedVersion)
        : createPolicy(input, idempotencyKey),
    onSuccess: (result) => {
      if (!organizationId) return;
      const queryKey = queryKeys.items.reminderPolicy(organizationId, itemId);
      queryClient.setQueryData<ItemReminderPolicyResponse>(queryKey, { policy: result.policy });
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
