import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDocumentType } from "../api/documentTypes.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateDocumentTypeInput, DocumentType } from "../api/types.js";

/** A20 (Block 4, D-2xx) - "Novo tipo" (ADMIN_ROLES, `docarchive:documenttype-create`). */
export function useCreateDocumentType() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<{ documentType: DocumentType }, unknown, CreateDocumentTypeInput>({
    mutationFn: (input) => createDocumentType(input),
    onSuccess: () => {
      // "list" subtree only (Codex block-review finding): the bare "documentTypes" prefix also
      // matches every open detail query, forcing an unrelated refetch on every create.
      if (organizationId) void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "documentTypes", "list"] });
    },
  });
}
