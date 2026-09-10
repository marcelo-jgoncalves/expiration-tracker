/** A08 (Block 3, D-2xx) - "Arquivar"/"Reativar" toggle (WRITE_ROLES, `subject:update` tier -
 * same POST /subjects/{subjectId}/archive endpoint flips status either direction). */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { archiveSubject } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useArchiveSubject(subjectId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<void, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => archiveSubject(subjectId, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.detail(organizationId, subjectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.dashboard(organizationId, "ACTIVE") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.dashboard(organizationId, "ARCHIVED") });
    },
  });
}
