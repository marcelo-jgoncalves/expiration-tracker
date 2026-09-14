import { useQuery } from "@tanstack/react-query";
import { listDocuments } from "../api/documents.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { DocumentsListResponse } from "../api/types.js";
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
