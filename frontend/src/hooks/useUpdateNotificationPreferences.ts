import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateNotificationPreferences } from "../api/notifications.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { NotificationPreferences, UpdateNotificationPreferencesInput } from "../api/types.js";

export interface UpdateNotificationPreferencesVariables extends UpdateNotificationPreferencesInput {
  expectedVersion: number;
}

/** A18 (Block 8, D-2xx) - "Salvar preferências". Real client-supplied OCC via `If-Match`
 * (`notification-preferences-service.ts#updatePreferences` takes it from the caller, unlike
 * A22's server-computed version) - `useOccMutation` surfaces a genuine conflict distinctly.
 *
 * Codex review round 1 (D-2xx) MÉDIO finding, corrected: `onSuccess` used to only fire an
 * unawaited `invalidateQueries` - until that background refetch actually landed (or forever, if
 * it failed), the cache still held the OLD `version`, so a second save shortly after the first
 * could send a stale `expectedVersion` and get a spurious 409. Writing the server's own response
 * straight into the cache via `setQueryData` makes the new version available immediately,
 * with no dependency on a refetch completing. */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ preferences: NotificationPreferences }, UpdateNotificationPreferencesVariables>({
    mutationFn: ({ expectedVersion, ...input }) => updateNotificationPreferences(input, expectedVersion),
    onSuccess: (data) => {
      if (organizationId) queryClient.setQueryData(queryKeys.notifications.preferences(organizationId), data);
    },
  });
}
