import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateOrganizationSettings } from "../api/members.js";
import { sessionQueryKey, organizationsListQueryKey } from "../api/queryKeys.js";
import type { OrganizationSettingsResponse } from "../api/types.js";

export interface UpdateOrganizationSettingsVariables {
  displayName?: string;
  timezone?: string;
  defaultReminderLocalTime?: string;
  expectedVersion: number;
}

/** OCC-protected, same discipline as every other tenant-scoped write in this app. Invalidates
 * the session query (not an "org" queryKeys entry) because `displayName` is surfaced by the
 * switcher/session data (`GET /bff/session`'s `organizationSelectionRequired`), not by any
 * `queryKeys.organizations.*` entry - there is no separate cached "current organization detail"
 * query today. Item 11 adversarial review (2026-09-25) real finding: `organizationsListQueryKey`
 * (`useOrganizationsList()`) is a SEPARATE cache from the session query and is where
 * `ItemReminderPolicy.tsx` reads `defaultReminderLocalTime` from - without invalidating it here
 * too, saving a new default time and immediately creating a trigger could still pick up the
 * stale value for as long as that query's staleTime allows. */
export function useUpdateOrganizationSettings() {
  const queryClient = useQueryClient();
  return useOccMutation<OrganizationSettingsResponse, UpdateOrganizationSettingsVariables>({
    mutationFn: ({ expectedVersion, ...input }) => updateOrganizationSettings(input, expectedVersion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      void queryClient.invalidateQueries({ queryKey: organizationsListQueryKey });
    },
  });
}
