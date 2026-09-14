import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateRequirement } from "../api/requirements.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { Requirement, UpdateRequirementInput } from "../api/types.js";

/** A11 (Block 3, D-2xx) - "Editar" (WRITE_ROLES, `docarchive:requirement-update`). PERF-10 fix:
 * see `useCreateRequirement`'s comment - also invalidates the Subject-scoped compliance/count
 * reads of this same Requirement, previously missed. */
export function useUpdateRequirement(subjectId: string, requirementId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ requirement: Requirement }, { input: UpdateRequirementInput; expectedVersion: number }>({
    mutationFn: ({ input, expectedVersion }) => updateRequirement(subjectId, requirementId, input, expectedVersion),
    onSuccess: () => {
      if (organizationId) {
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirements", "search"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.subjectCompliance(organizationId, subjectId) });
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirementsForSubject", subjectId] });
      }
    },
  });
}
