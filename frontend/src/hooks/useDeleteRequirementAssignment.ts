/** A10 (Block 7, D-2xx) - "Excluir vínculo" (ADMIN_ROLES only, `requirement:delete`). Soft-delete
 * (backend sets `deletedAt`) - the caller navigates back to the list on success (the assignment
 * disappears from `useRequirementAssignments`' next fetch). */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { deleteRequirementAssignment } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useDeleteRequirementAssignment(subjectId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<void, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => deleteRequirementAssignment(subjectId, assignmentId, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.requirements(organizationId, subjectId) });
    },
  });
}
