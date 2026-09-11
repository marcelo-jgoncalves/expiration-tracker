import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateRequirementAssignment } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { RequirementAssignmentResponse, UpdateRequirementAssignmentInput } from "../api/types.js";

export interface UpdateAssignmentVariables extends UpdateRequirementAssignmentInput {
  expectedVersion: number;
}

/** A10 (Block 7, D-2xx) - "Editar" (name/notes only, `requirement:update`, WRITE_ROLES). */
export function useUpdateRequirementAssignment(subjectId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<RequirementAssignmentResponse, UpdateAssignmentVariables>({
    mutationFn: ({ expectedVersion, ...input }) => updateRequirementAssignment(subjectId, assignmentId, input, expectedVersion),
    onSuccess: () => {
      if (organizationId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.requirements(organizationId, subjectId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.assignmentDetail(organizationId, subjectId, assignmentId) });
      }
    },
  });
}
