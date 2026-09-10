import { useQuery } from "@tanstack/react-query";
import { fetchStorageUsage } from "../api/storageQuota.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { StorageUsageResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A03 (D-2xx addendum) conditional storage card, and A19's own "seção de armazenamento" -
 * same org-scoped/enabled-gating convention as `useMembers`. `docarchive:read` is
 * READ_ONLY_ROLES (every role) in the backend matrix, matching A03's "todos os papéis" access. */
export function useStorageQuota() {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<StorageUsageResponse, unknown>({
    queryKey: queryKeys.documentArchive.storageUsage(organizationId ?? ""),
    queryFn: ({ signal }) => fetchStorageUsage({ signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
