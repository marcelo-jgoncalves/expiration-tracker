/** A15 (Block 9) — `POST /imports/{jobId}/commit` (`import:commit`, WRITE_ROLES), OCC-guarded.
 * Fire-and-forget: the real commit runs in an async worker, so a 202 here carries no result body
 * (`ImportWizard`'s own commit step relies entirely on `useImportJob`'s poll to observe
 * `COMMITTING` → `COMMITTED`/`FAILED`). The double-submit guard the spec asks for
 * ("Reenviar... é bloqueado no cliente") is `mutation.isPending` plus the caller only rendering
 * this action while `job.status === "PREVIEW_READY"` — once the mutation succeeds the job moves
 * to `COMMITTING` and the button disappears entirely, never merely disabled-in-place. */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { requestImportCommit } from "../api/imports.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

interface RequestImportCommitVariables {
  jobId: string;
  expectedVersion: number;
}

export function useRequestImportCommit() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<void, RequestImportCommitVariables>({
    mutationFn: ({ jobId, expectedVersion }) => requestImportCommit(jobId, expectedVersion),
    onSettled: (_data, _error, variables) => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.imports.detail(organizationId, variables.jobId) });
    },
  });
}
