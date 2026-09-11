/**
 * A15 (Block 9) — `GET /imports/{jobId}` (`import:read`, all roles). Drives the whole resumable
 * wizard: the caller derives which step to render purely from `job.status`
 * (`routes/imports/ImportWizard.tsx`), never from client-side wizard state, so reopening
 * `/imports/:jobId` after a reload resumes exactly where the job really is (P0.2).
 *
 * `refetchInterval` polls every 2s ONLY while `status` is one the backend can still move on its
 * own (`UPLOADED`/`AWAITING_MAPPING`/`PARSING` while the S3-triggered parse worker runs,
 * `COMMITTING` while the commit worker runs) - a terminal status (`PREVIEW_READY` waiting on the
 * user, `COMMITTED`/`FAILED`/`EXPIRED`) stops polling on its own, no manual `stopPolling` call
 * needed anywhere.
 */
import { useQuery } from "@tanstack/react-query";
import { getImportJob } from "../api/imports.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { GetImportJobResult, ImportJobStatus } from "../api/types.js";

const TRANSIENT_STATUSES: ReadonlySet<ImportJobStatus> = new Set(["UPLOADED", "AWAITING_MAPPING", "PARSING", "COMMITTING"]);

const DISABLED_QUERY_KEY = ["imports", "detail", "disabled"] as const;

export function useImportJob(jobId: string | undefined) {
  const { organizationId } = useActiveOrganization();
  const enabled = Boolean(jobId && organizationId);

  return useQuery<GetImportJobResult>({
    queryKey: jobId && organizationId ? queryKeys.imports.detail(organizationId, jobId) : DISABLED_QUERY_KEY,
    queryFn: ({ signal }) => getImportJob(jobId as string, { signal }),
    enabled,
    retry: retryPolicyFor("safe-read"),
    refetchInterval: (query) => (query.state.data && TRANSIENT_STATUSES.has(query.state.data.job.status) ? 2000 : false),
  });
}
