import { useQuery } from "@tanstack/react-query";
import { listDocuments, getDocumentExtraction } from "../api/documents.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { DocumentsListResponse, ExtractionDisclosureResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

// PERF-10: OPERATIONAL - attachments list changes with routine upload activity.
export function useDocuments(itemId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<DocumentsListResponse, unknown>({
    queryKey: queryKeys.items.documents(organizationId ?? "", itemId),
    queryFn: ({ signal }) => listDocuments(itemId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && itemId.length > 0,
    staleTime: STALE_TIME.OPERATIONAL,
  });
}

/** D-349 - A07's AI-disclosure read, one query per (itemId, documentId). */
export function useDocumentExtraction(itemId: string, documentId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<ExtractionDisclosureResponse, unknown>({
    queryKey: queryKeys.items.documentExtraction(organizationId ?? "", itemId, documentId),
    queryFn: ({ signal }) => getDocumentExtraction(itemId, documentId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && itemId.length > 0 && documentId.length > 0,
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
