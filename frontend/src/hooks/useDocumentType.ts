import { useQuery } from "@tanstack/react-query";
import { fetchDocumentType } from "../api/documentTypes.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DocumentType } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A20 (Block 4, D-2xx) - the metadata field editor's single-type detail read. */
export function useDocumentType(documentTypeId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ documentType: DocumentType }, unknown>({
    queryKey: queryKeys.documentArchive.documentType(organizationId ?? "", documentTypeId),
    queryFn: ({ signal }) => fetchDocumentType(documentTypeId, { signal }),
    enabled: Boolean(organizationId) && !switching && Boolean(documentTypeId),
    retry: retryPolicyFor("safe-read"),
  });
}
