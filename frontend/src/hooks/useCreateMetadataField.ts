import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { createMetadataField } from "../api/documentTypes.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { CreateDocumentTypeMetadataFieldInput, DocumentType } from "../api/types.js";

/** A20 (Block 4, D-2xx) - "Adicionar campo" (ADMIN_ROLES, `docarchive:documenttype-metadata-manage`).
 * Fences the owning DocumentType's version (a field has no version of its own). */
export function useCreateMetadataField(documentTypeId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ documentType: DocumentType }, { input: CreateDocumentTypeMetadataFieldInput; expectedDocumentTypeVersion: number }>({
    mutationFn: ({ input, expectedDocumentTypeVersion }) => createMetadataField(documentTypeId, expectedDocumentTypeVersion, input),
    onSuccess: (data) => {
      if (organizationId) {
        // The LIST keys only, never the "documentTypes" prefix bare (which would also match
        // this exact detail query and re-trigger a refetch racing the `setQueryData` above -
        // real backends would return fresh data either way, but nothing here needs a network
        // round trip when the mutation response already carries the authoritative new state).
        queryClient.setQueryData(queryKeys.documentArchive.documentType(organizationId, documentTypeId), data);
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "documentTypes", "list"] });
      }
    },
  });
}
