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
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { ImportJobSchemaResult } from "../api/types.js";

const DISABLED_QUERY_KEY = ["imports", "schema", "disabled"] as const;

export function useImportJobSchema(jobId: string | undefined, enabled: boolean) {
  const { organizationId } = useActiveOrganization();
  const isEnabled = Boolean(jobId && organizationId && enabled);

  return useQuery<ImportJobSchemaResult>({
    queryKey: jobId && organizationId ? queryKeys.imports.schema(organizationId, jobId) : DISABLED_QUERY_KEY,
    queryFn: ({ signal }) => getImportJobSchema(jobId as string, { signal }),
    enabled: isEnabled,
    retry: retryPolicyFor("safe-read"),
  });
}
