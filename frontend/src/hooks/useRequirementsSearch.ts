import { useQuery } from "@tanstack/react-query";
import { searchRequirements } from "../api/requirements.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { RequirementSearchPage, RequirementStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A11 (Block 3, D-2xx) - tenant-wide search, `status` required (no unfiltered mode). */
export function useRequirementsSearch(status: RequirementStatus, namePrefix?: string, assigneeUserId?: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<RequirementSearchPage, unknown>({
    queryKey: queryKeys.documentArchive.requirementsSearch(organizationId ?? "", status, namePrefix, assigneeUserId),
    queryFn: ({ signal }) => searchRequirements({ status, namePrefix, assigneeUserId }, { signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
