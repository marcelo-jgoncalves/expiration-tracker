import { useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptInvitation, type AcceptInvitationResponse } from "../api/organizations.js";
import { sessionQueryKey } from "../api/queryKeys.js";

/** Invalidates the session query (same reasoning as `useCreateOrganization`) so
 * `ActiveOrganizationProvider` picks up the newly-accepted Membership on its next
 * `GET /bff/session`, rather than assuming this mutation's own response shape substitutes for
 * that. */
export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation<AcceptInvitationResponse, unknown, string>({
    mutationFn: (token) => acceptInvitation(token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}
