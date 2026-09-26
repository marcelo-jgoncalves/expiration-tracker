import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateDocumentRequestDeliveryPreference } from "../api/documentRequests.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { DocumentRequestDeliveryMode } from "../api/types.js";

/** A22 (ADR-0016 Decision B) - "Salvar padrão". Plain `useMutation`, not `useOccMutation` - the
 * backend accepts no CLIENT-supplied `expectedVersion` for this endpoint (see
 * `updateDocumentRequestDeliveryPreference`'s own doc comment in `documentRequests.ts`), but it
 * can still throw a genuine `ConflictError` internally - callers must check `isConflict(error)`
 * on this mutation's error, same as any other write (see `RequestDeliverySettings.tsx`). */
export function useUpdateDocumentRequestDeliveryPreference() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<void, unknown, DocumentRequestDeliveryMode>({
    mutationFn: (mode) => updateDocumentRequestDeliveryPreference(mode),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.documentRequestDeliveryPreference(organizationId) });
    },
  });
}
