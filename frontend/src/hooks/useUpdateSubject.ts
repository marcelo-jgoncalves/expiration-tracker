/** A08/A09 (Block 3, D-2xx) - "Editar fornecedor" (WRITE_ROLES, `subject:update`). OCC via
 * `expectedVersion`, same convention as every other mutation in this app. */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateSubject } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { SubjectResponse, UpdateSubjectInput } from "../api/types.js";

export function useUpdateSubject(subjectId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useOccMutation<SubjectResponse, { input: UpdateSubjectInput; expectedVersion: number }>({
    mutationFn: ({ input, expectedVersion }) => updateSubject(subjectId, input, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.detail(organizationId, subjectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.dashboard(organizationId, "ACTIVE") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.dashboard(organizationId, "ARCHIVED") });
    },
  });
}
