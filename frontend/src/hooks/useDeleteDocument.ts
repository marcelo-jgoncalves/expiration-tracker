import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteDocument } from "../api/documents.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** `document:delete` is ADMIN_ROLES (authorization.ts:280) - the exact RBAC bug already
 * corrected once in A05 (D-2xx audit batch 2) and named again as a CRITICAL fix in A07's own
 * audit record. This hook performs no client-side role check itself (that's the screen's job,
 * same "hide, don't just disable" discipline as everywhere else) - the backend's own
 * `authorize()` call is the real boundary either way. */
export function useDeleteDocument(itemId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<void, unknown, { documentId: string }>({
    mutationFn: ({ documentId }) => deleteDocument(itemId, documentId),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.items.documents(organizationId, itemId) });
    },
  });
}
