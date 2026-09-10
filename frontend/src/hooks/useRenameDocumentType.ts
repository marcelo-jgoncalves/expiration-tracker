import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { renameDocumentType } from "../api/documentTypes.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { DocumentType } from "../api/types.js";

/** A20 (Block 4, D-2xx) - "Renomear" (ADMIN_ROLES, `docarchive:documenttype-rename`). */
export function useRenameDocumentType(documentTypeId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ documentType: DocumentType }, { displayName: string; expectedVersion: number }>({
    mutationFn: ({ displayName, expectedVersion }) => renameDocumentType(documentTypeId, displayName, expectedVersion),
    onSuccess: (data) => {
      if (!organizationId) return;
      // See `useDeprecateDocumentType`'s identical comment.
      queryClient.setQueryData(queryKeys.documentArchive.documentType(organizationId, documentTypeId), data);
      void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "documentTypes", "list"] });
    },
  });
}
