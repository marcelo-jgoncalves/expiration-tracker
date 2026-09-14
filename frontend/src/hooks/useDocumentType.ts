import { useQuery } from "@tanstack/react-query";
import { fetchDocumentType } from "../api/documentTypes.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { DocumentType } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A20 (Block 4, D-2xx) - the metadata field editor's single-type detail read. PERF-10:
 * STATICISH, same reasoning as `useDocumentTypes`. */
export function useDocumentType(documentTypeId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ documentType: DocumentType }, unknown>({
    queryKey: queryKeys.documentArchive.documentType(organizationId ?? "", documentTypeId),
    queryFn: ({ signal }) => fetchDocumentType(documentTypeId, { signal }),
    enabled: Boolean(organizationId) && !switching && Boolean(documentTypeId),
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.STATICISH,
  });
}
