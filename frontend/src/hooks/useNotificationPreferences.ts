import { useQuery } from "@tanstack/react-query";
import { fetchNotificationPreferences } from "../api/notifications.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { NotificationPreferences } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A18 (Block 8, D-2xx) - every real role reads/edits only their own preferences. */
export function useNotificationPreferences() {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ preferences: NotificationPreferences }, unknown>({
    queryKey: queryKeys.notifications.preferences(organizationId ?? ""),
    queryFn: ({ signal }) => fetchNotificationPreferences({ signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching,
  });
}
