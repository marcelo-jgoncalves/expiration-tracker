/**
 * D-293 - closes A16's execution-history gap. Only fetched once a subscription's history is
 * actually opened (`enabled` gate below) - same "no speculative reads" discipline as
 * `useDocumentSubmissions`/`useImportRowResults`.
 */
import { useQuery } from "@tanstack/react-query";
import { listSubscriptionRuns } from "../api/reports.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { ListSubscriptionRunsResult } from "../api/types.js";

const DISABLED_QUERY_KEY = ["reports", "subscriptionRuns", "disabled"] as const;

export function useReportSubscriptionRuns(subscriptionId: string | undefined, enabled: boolean) {
  const { organizationId } = useActiveOrganization();
  const isEnabled = Boolean(subscriptionId && organizationId && enabled);

  return useQuery<ListSubscriptionRunsResult>({
    queryKey: subscriptionId && organizationId ? queryKeys.reports.subscriptionRuns(organizationId, subscriptionId) : DISABLED_QUERY_KEY,
    queryFn: ({ signal }) => listSubscriptionRuns(subscriptionId as string, { signal }),
    enabled: isEnabled,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
