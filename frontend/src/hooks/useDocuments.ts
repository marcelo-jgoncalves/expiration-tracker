import { useQuery } from "@tanstack/react-query";
import { listDocuments } from "../api/documents.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DocumentsListResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useDocuments(itemId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<DocumentsListResponse, unknown>({
    queryKey: queryKeys.items.documents(organizationId ?? "", itemId),
    queryFn: ({ signal }) => listDocuments(itemId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && itemId.length > 0,
  });
}
