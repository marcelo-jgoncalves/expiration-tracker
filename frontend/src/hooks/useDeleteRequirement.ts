import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { deleteRequirement } from "../api/requirements.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A11 (Block 3, D-2xx) - "Excluir" (WRITE_ROLES, not ADMIN_ROLES - `docarchive:requirement-
 * delete`'s confirmed exception tier). */
export function useDeleteRequirement(subjectId: string, requirementId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<void, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => deleteRequirement(subjectId, requirementId, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirements", "search"] });
    },
  });
}
