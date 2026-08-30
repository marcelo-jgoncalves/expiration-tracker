import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createOrganization, type CreateOrganizationResponse } from "../api/organizations.js";
import { sessionQueryKey } from "../api/queryKeys.js";

export interface CreateOrganizationVariables {
  displayName: string;
  timezone: string;
}

/** No OCC here (unlike useUpdateOrganizationSettings) - this is a create, not a versioned
 * update to an existing row. Invalidates the session query so ActiveOrganizationProvider
 * picks up the new activeOrganizationId on the next GET /bff/session (POST /bff/organizations
 * itself only returns {organizationId}, never the full session shape). */
export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation<CreateOrganizationResponse, unknown, CreateOrganizationVariables>({
    mutationFn: (input) => createOrganization(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}
