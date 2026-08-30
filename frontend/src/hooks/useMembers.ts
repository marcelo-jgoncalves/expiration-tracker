import { useQuery } from "@tanstack/react-query";
import { fetchMembers } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { MembersResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useMembers() {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<MembersResponse, unknown>({
    queryKey: queryKeys.organizations.members(organizationId ?? ""),
    queryFn: ({ signal }) => fetchMembers({ signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
