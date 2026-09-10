import { useQuery } from "@tanstack/react-query";
import { getPolicyForItem } from "../api/reminderPolicy.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { ItemReminderPolicyResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A06 (Block 2 D-258) - `policy: null` in the response is a legitimate "no policy yet"
 * state (never surfaced as an error by this hook). */
export function useReminderPolicy(itemId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<ItemReminderPolicyResponse, unknown>({
    queryKey: queryKeys.items.reminderPolicy(organizationId ?? "", itemId),
    queryFn: ({ signal }) => getPolicyForItem(itemId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && itemId.length > 0,
  });
}
