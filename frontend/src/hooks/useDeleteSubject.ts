/** A08/A09 (Block 3, D-2xx) - "Excluir" (ADMIN_ROLES only, `subject:delete`). The backend
 * rejects deletion when active Requirements are still linked (`BUSINESS_RULE`) - the caller
 * surfaces that as the "exclusão bloqueada" dialog per A08's spec, never a generic error. */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { deleteSubject } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useDeleteSubject(subjectId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<void, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => deleteSubject(subjectId, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.dashboard(organizationId, "ACTIVE") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.dashboard(organizationId, "ARCHIVED") });
    },
  });
}
