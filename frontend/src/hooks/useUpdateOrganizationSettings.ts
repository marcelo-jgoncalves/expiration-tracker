import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateOrganizationSettings } from "../api/members.js";
import { sessionQueryKey } from "../api/queryKeys.js";
import type { OrganizationSettingsResponse } from "../api/types.js";

export interface UpdateOrganizationSettingsVariables {
  displayName?: string;
  timezone?: string;
  expectedVersion: number;
}

/** OCC-protected, same discipline as every other tenant-scoped write in this app. Invalidates
 * the session query (not an "org" queryKeys entry) because `displayName` is surfaced by the
 * switcher/session data (`GET /bff/session`'s `organizationSelectionRequired`), not by any
 * `queryKeys.organizations.*` entry - there is no separate cached "current organization detail"
 * query today. */
export function useUpdateOrganizationSettings() {
  const queryClient = useQueryClient();
  return useOccMutation<OrganizationSettingsResponse, UpdateOrganizationSettingsVariables>({
    mutationFn: ({ expectedVersion, ...input }) => updateOrganizationSettings(input, expectedVersion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}
