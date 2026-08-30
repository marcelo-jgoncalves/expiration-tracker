import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { unlinkExpirationItem } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import type { RequirementAssignmentResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export interface UnlinkVariables {
  expectedVersion: number;
}

export function useUnlinkExpirationItem(subjectId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<RequirementAssignmentResponse, UnlinkVariables>({
    mutationFn: ({ expectedVersion }) => unlinkExpirationItem(subjectId, assignmentId, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.requirements(organizationId, subjectId) });
    },
  });
}
