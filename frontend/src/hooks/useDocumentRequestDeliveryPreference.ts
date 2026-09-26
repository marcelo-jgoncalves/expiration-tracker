import { useQuery } from "@tanstack/react-query";
import { fetchDocumentRequestDeliveryPreference } from "../api/documentRequests.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { DocumentRequestDeliveryMode } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A22 (ADR-0016 Decision B) - tenant-wide, OWNER-only. `enabled` is caller-supplied so a
 * non-OWNER role never even issues the read (the backend would 403 it anyway - this only avoids
 * a guaranteed-failing request). PERF-10: REFERENCE - a tenant-wide setting an OWNER edits
 * rarely. `useUpdateDocumentRequestDeliveryPreference` invalidates this key precisely on save,
 * so the cache window never shows a stale value right after the OWNER changes it. */
export function useDocumentRequestDeliveryPreference(enabled: boolean) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ initialInviteDeliveryDefault: DocumentRequestDeliveryMode }, unknown>({
    queryKey: queryKeys.documentArchive.documentRequestDeliveryPreference(organizationId ?? ""),
    queryFn: ({ signal }) => fetchDocumentRequestDeliveryPreference({ signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: enabled && Boolean(organizationId) && !switching,
    staleTime: STALE_TIME.REFERENCE,
  });
}
