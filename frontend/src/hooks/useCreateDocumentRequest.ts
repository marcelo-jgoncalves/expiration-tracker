/** A14 (Block 6, D-2xx) - "Nova solicitação avulsa" (WRITE_ROLES, `docarchive:request-create`).
 * Idempotent (the backend's `createDocumentRequest` requires `idempotencyKey`) - same discipline
 * as `useCreateSubject`. No `persistenceKey`: the dialog itself is the submission's whole
 * lifetime (never survives a reload, unlike a full-page form), so an in-memory-only key is
 * already correct - re-mounting the dialog for a genuinely NEW submission gets a fresh key for
 * free. */
import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { createDocumentRequest } from "../api/documentRequests.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateDocumentRequestInput, DocumentRequest } from "../api/types.js";

export function useCreateDocumentRequest(subjectId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useIdempotentMutation<{ documentRequest: DocumentRequest }, Omit<CreateDocumentRequestInput, "idempotencyKey">>({
    mutationFn: (input, idempotencyKey) => createDocumentRequest({ ...input, idempotencyKey }),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.documentRequests(organizationId, subjectId) });
    },
  });
}
