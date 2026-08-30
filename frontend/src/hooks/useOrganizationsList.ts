import { useQuery } from "@tanstack/react-query";
import { fetchOrganizations } from "../api/organizations.js";
import { organizationsListQueryKey } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";

/** The full list of Organizations the user belongs to (`GET /bff/organizations`) - distinct
 * from `useActiveOrganization()`, which only exposes the currently-selected `organizationId`.
 * Used by the switcher (needs every organization's displayName to render options) and by
 * anywhere that needs the CURRENT organization's own displayName (not itself part of the
 * session response - look it up here by `organizationId`). Deliberately NOT gated by
 * `switching` (it is the list a user picks FROM, not itself organization-scoped data). */
export function useOrganizationsList() {
  return useQuery({
    queryKey: organizationsListQueryKey,
    queryFn: ({ signal }) => fetchOrganizations({ signal }),
    retry: retryPolicyFor("safe-read"),
  });
}
