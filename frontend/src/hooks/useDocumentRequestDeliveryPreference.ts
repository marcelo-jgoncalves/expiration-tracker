import { useQuery } from "@tanstack/react-query";
import { fetchDocumentRequestDeliveryPreference } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DocumentRequestDeliveryMode } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A22 (Block 7, D-2xx) - tenant-wide, OWNER-only. `enabled` is caller-supplied so a non-OWNER
 * role never even issues the read (the backend would 403 it anyway - this only avoids a
 * guaranteed-failing request). */
export function useDocumentRequestDeliveryPreference(enabled: boolean) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ initialInviteDeliveryDefault: DocumentRequestDeliveryMode }, unknown>({
    queryKey: queryKeys.subjects.documentRequestDeliveryPreference(organizationId ?? ""),
    queryFn: ({ signal }) => fetchDocumentRequestDeliveryPreference({ signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: enabled && Boolean(organizationId) && !switching,
  });
}
