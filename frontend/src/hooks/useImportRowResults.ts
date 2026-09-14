/**
 * D-292 — closes A15's per-row drill-down gap. `GET /import-jobs/{jobId}/row-results`
 * (`import:read`), readable once a plan exists (`PREVIEW_READY` onward — the backend 409s
 * before that, same discipline as `useImportJobSchema`'s own `enabled` pattern). Never fetched
 * speculatively; the caller passes `enabled` explicitly.
 */
import { useQuery } from "@tanstack/react-query";
import { getImportRowResults } from "../api/imports.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { GetImportRowResultsResult } from "../api/types.js";

const DISABLED_QUERY_KEY = ["imports", "rowResults", "disabled"] as const;

export function useImportRowResults(jobId: string | undefined, enabled: boolean) {
  const { organizationId } = useActiveOrganization();
  const isEnabled = Boolean(jobId && organizationId && enabled);

  return useQuery<GetImportRowResultsResult>({
    queryKey: jobId && organizationId ? queryKeys.imports.rowResults(organizationId, jobId) : DISABLED_QUERY_KEY,
    queryFn: ({ signal }) => getImportRowResults(jobId as string, { signal }),
    enabled: isEnabled,
    retry: retryPolicyFor("safe-read"),
  });
}
