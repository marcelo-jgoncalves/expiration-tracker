import { useQuery } from "@tanstack/react-query";
import { fetchInvitations } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { InvitationsResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useInvitations() {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<InvitationsResponse, unknown>({
    queryKey: queryKeys.organizations.invitations(organizationId ?? ""),
    queryFn: ({ signal }) => fetchInvitations({ signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
  });
}
