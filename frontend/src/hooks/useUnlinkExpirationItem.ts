import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { unlinkExpirationItem } from "../api/subjects.js";
import type { RequirementAssignmentResponse } from "../api/types.js";

export interface UnlinkVariables {
  expectedVersion: number;
}

export function useUnlinkExpirationItem(subjectId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  return useOccMutation<RequirementAssignmentResponse, UnlinkVariables>({
    mutationFn: ({ expectedVersion }) => unlinkExpirationItem(subjectId, assignmentId, expectedVersion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["subjects", "requirements", subjectId] });
    },
  });
}
