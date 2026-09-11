/** A15 (Block 9) — `POST /import-jobs/{jobId}/mapping` (`import:map`, WRITE_ROLES), OCC-guarded
 * (`If-Match`, same discipline as every other versioned mutation in this app). Not
 * idempotency-keyed - unlike create/renew, a resubmission of the exact same mapping is naturally
 * idempotent server-side (same `columnMapping` in, same OCC-guarded transition), and a genuine
 * retry-with-different-input scenario doesn't apply to a value the user can freely re-edit
 * before resubmitting anyway. */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { submitImportMapping } from "../api/imports.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { ColumnMapping, SubmitImportMappingResult } from "../api/types.js";

interface SubmitImportMappingVariables {
  jobId: string;
  columnMapping: ColumnMapping;
  expectedVersion: number;
}

export function useSubmitImportMapping() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<SubmitImportMappingResult, SubmitImportMappingVariables>({
    mutationFn: ({ jobId, columnMapping, expectedVersion }) => submitImportMapping(jobId, columnMapping, expectedVersion),
    onSettled: (_data, _error, variables) => {
      // Refetch immediately either way - on success this picks up the new status/version right
      // away instead of waiting for the next 2s poll tick; on a 409 CONFLICT it pulls the
      // now-current job state so the wizard re-renders from reality instead of a stale read.
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.imports.detail(organizationId, variables.jobId) });
    },
  });
}
