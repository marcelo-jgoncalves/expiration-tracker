import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignRequirement } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { AssignRequirementInput, RequirementAssignmentResponse } from "../api/types.js";

/** A10 (Block 7, D-2xx) - "Novo vínculo legado" (`requirement:assign`, WRITE_ROLES). No
 * idempotency-key contract on the backend (`assignRequirement` in `requirement-service.ts` takes
 * none), same reasoning as `useCreateRequirement`. */
export function useAssignRequirement(subjectId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<RequirementAssignmentResponse, unknown, AssignRequirementInput>({
    mutationFn: (input) => assignRequirement(subjectId, input),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.requirements(organizationId, subjectId) });
    },
  });
}
