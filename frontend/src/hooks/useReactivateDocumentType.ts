import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { reactivateDocumentType } from "../api/documentTypes.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { DocumentType } from "../api/types.js";

/** A20 (Block 4, D-2xx) - "Reativar" (ADMIN_ROLES, `docarchive:documenttype-reactivate`). */
export function useReactivateDocumentType(documentTypeId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ documentType: DocumentType }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => reactivateDocumentType(documentTypeId, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "documentTypes"] });
    },
  });
}
