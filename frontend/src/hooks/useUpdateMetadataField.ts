import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateMetadataField } from "../api/documentTypes.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { DocumentType, UpdateDocumentTypeMetadataFieldInput } from "../api/types.js";

/** A20 (Block 4, D-2xx) - field reorder/rename/required/archive/reactivate and option
 * add/rename/archive/reactivate, all ADMIN_ROLES (`docarchive:documenttype-metadata-manage`)
 * and all funneled through this single PATCH (D-218 Decision 7 - one OCC-fenced write). */
export function useUpdateMetadataField(documentTypeId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ documentType: DocumentType }, { fieldId: string; input: UpdateDocumentTypeMetadataFieldInput; expectedDocumentTypeVersion: number }>({
    mutationFn: ({ fieldId, input, expectedDocumentTypeVersion }) => updateMetadataField(documentTypeId, fieldId, expectedDocumentTypeVersion, input),
    onSuccess: (data) => {
      if (organizationId) {
        // See `useCreateMetadataField`'s identical comment: LIST keys only, never the bare
        // "documentTypes" prefix (which would also match this exact detail query and race the
        // `setQueryData` above).
        queryClient.setQueryData(queryKeys.documentArchive.documentType(organizationId, documentTypeId), data);
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "documentTypes", "list"] });
      }
    },
  });
}
