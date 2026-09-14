import { useQuery } from "@tanstack/react-query";
import { listDocumentTypes } from "../api/documentTypes.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { DocumentType, DocumentTypeStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A20 (Block 4, D-2xx) - catalog list, one status per query (backend has no unfiltered "ALL"
 * mode - same discipline as A11's `useRequirementsSearch`). `enabled` lets the screen gate a
 * status it isn't currently showing. PERF-10: STATICISH - an OWNER/ADMIN edits this catalog
 * rarely, so a several-minute cache window is invisible in normal use. */
export function useDocumentTypes(status: DocumentTypeStatus, enabled = true) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ documentTypes: DocumentType[] }, unknown>({
    queryKey: queryKeys.documentArchive.documentTypes(organizationId ?? "", status),
    queryFn: ({ signal }) => listDocumentTypes(status, { signal }),
    enabled: Boolean(organizationId) && !switching && enabled,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.STATICISH,
  });
}
