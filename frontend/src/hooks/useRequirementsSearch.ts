import { useQuery } from "@tanstack/react-query";
import { searchRequirements } from "../api/requirements.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { RequirementSearchPage, RequirementStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A11 (Block 3, D-2xx) - tenant-wide search, `status` required (no unfiltered mode). `enabled`
 * additionally gates the query (default true) - RequirementsCollection uses this to fetch each
 * of the 5 real statuses ONLY while the "Todos" tab is active, never all 5 unconditionally
 * (Codex Block 3 review round 1 finding 14). */
export function useRequirementsSearch(status: RequirementStatus, namePrefix?: string, assigneeUserId?: string, enabled = true) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<RequirementSearchPage, unknown>({
    queryKey: queryKeys.documentArchive.requirementsSearch(organizationId ?? "", status, namePrefix, assigneeUserId),
    queryFn: ({ signal }) => searchRequirements({ status, namePrefix, assigneeUserId }, { signal }),
    enabled: Boolean(organizationId) && !switching && enabled,
    retry: retryPolicyFor("safe-read"),
  });
}
