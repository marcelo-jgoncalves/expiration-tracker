import { useQuery } from "@tanstack/react-query";
import { fetchInvitations } from "../api/members.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { InvitationsResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

// PERF-10: REFERENCE - invitations change with membership activity, not moment to moment.
export function useInvitations() {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<InvitationsResponse, unknown>({
    queryKey: queryKeys.organizations.invitations(organizationId ?? ""),
    queryFn: ({ signal }) => fetchInvitations({ signal }),
    enabled: Boolean(organizationId) && !switching,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.REFERENCE,
  });
}
