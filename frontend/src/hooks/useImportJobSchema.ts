/**
 * A15 (Block 9) — `GET /import-jobs/{jobId}/schema` (`import:read`). Only ever meaningfully
 * callable while the job is `UPLOADED`/`AWAITING_MAPPING` (the backend itself 409s otherwise,
 * `ImportService.getImportJobSchema`) — the caller passes `enabled` explicitly rather than this
 * hook re-deriving it, so the mapping step's own step-detection stays the single source of
 * truth for "is this job mappable right now".
 */
import { useQuery } from "@tanstack/react-query";
import { getImportJobSchema } from "../api/imports.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { ImportJobSchemaResult } from "../api/types.js";

const DISABLED_QUERY_KEY = ["imports", "schema", "disabled"] as const;

// PERF-10: NEAR_REALTIME - only ever enabled for one specific job/step of an active wizard the
// user is watching move through backend-driven states; a cached read here could show a schema
// from before the user's own mapping edit round-tripped.
export function useImportJobSchema(jobId: string | undefined, enabled: boolean) {
  const { organizationId } = useActiveOrganization();
  const isEnabled = Boolean(jobId && organizationId && enabled);

  return useQuery<ImportJobSchemaResult>({
    queryKey: jobId && organizationId ? queryKeys.imports.schema(organizationId, jobId) : DISABLED_QUERY_KEY,
    queryFn: ({ signal }) => getImportJobSchema(jobId as string, { signal }),
    enabled: isEnabled,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.NEAR_REALTIME,
  });
}
