import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { deprecateDocumentType } from "../api/documentTypes.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { DocumentType } from "../api/types.js";

/** A20 (Block 4, D-2xx) - "Descontinuar" (ADMIN_ROLES, `docarchive:documenttype-deprecate`) -
 * reversible/non-destructive (SLF-04): the type is never deleted, only removed from new-upload
 * selection and guest visibility. */
export function useDeprecateDocumentType(documentTypeId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ documentType: DocumentType }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => deprecateDocumentType(documentTypeId, expectedVersion),
    onSuccess: (data) => {
      if (!organizationId) return;
      // "list" subtree only, plus a deliberate update of THIS ONE detail query (Codex
      // block-review finding: the bare "documentTypes" prefix also matched every unrelated open
      // detail query, forcing a needless refetch of every other type on a single deprecate).
      queryClient.setQueryData(queryKeys.documentArchive.documentType(organizationId, documentTypeId), data);
      void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "documentTypes", "list"] });
    },
  });
}
