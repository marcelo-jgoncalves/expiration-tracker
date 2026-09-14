/**
 * A12 (Block 5, D-2xx) — Document Detail / Version History. Document metadata and its version
 * list are two independent queries (never merged) — mirrors `useReviewQueue.ts`'s per-state
 * query discipline. `enabled` follows the same `organizationId`/`switching` gate every
 * org-scoped hook in this codebase uses.
 */
import { useQuery } from "@tanstack/react-query";
import { getDocument, listDocumentVersions } from "../api/documentArchive.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { DocumentArchiveDocument, DocumentArchiveVersion } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

// PERF-10: OPERATIONAL - document metadata/version history changes with routine review activity.
export function useDocument(documentId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ document: DocumentArchiveDocument }, unknown>({
    queryKey: queryKeys.documentArchive.document(organizationId ?? "", documentId),
    queryFn: ({ signal }) => getDocument(documentId, { signal }),
    enabled: Boolean(organizationId) && !switching && Boolean(documentId),
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.OPERATIONAL,
  });
}

export function useDocumentVersions(documentId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ versions: DocumentArchiveVersion[] }, unknown>({
    queryKey: queryKeys.documentArchive.documentVersions(organizationId ?? "", documentId),
    queryFn: ({ signal }) => listDocumentVersions(documentId, { signal }),
    enabled: Boolean(organizationId) && !switching && Boolean(documentId),
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
