import { useQuery } from "@tanstack/react-query";
import { listReportSubscriptions } from "../api/reports.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { ReportSubscriptionsResponse } from "../api/types.js";

/** A16 (Block 10, D-2xx) - `reports:subscription-manage`, ADMIN_ROLES only. `enabled` must be
 * the caller's own role check (same explicit-gate discipline as `useActivity`'s `enabled` param)
 * - `organizationId` alone resolves synchronously from the stub context in tests/real app, while
 * `role` resolves asynchronously, so gating on `organizationId` alone would fire this query for
 * every role for one render before a permission redirect/EmptyState ever kicks in. */
export function useReportSubscriptions(enabled: boolean) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<ReportSubscriptionsResponse, unknown>({
    queryKey: queryKeys.reports.subscriptions(organizationId ?? ""),
    queryFn: ({ signal }) => listReportSubscriptions({ signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: enabled && Boolean(organizationId) && !switching,
  });
}
