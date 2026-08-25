import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { linkExpirationItem } from "../api/subjects.js";
import type { RequirementAssignmentResponse } from "../api/types.js";

export interface LinkVariables {
  itemId: string;
  expectedVersion: number;
}

/** BLOCKER-C's review action (Variante B): the operator links an already-existing
 * ExpirationItem to satisfy a MISSING requirement, after reviewing the uploaded evidence.
 * OCC-protected (useOccMutation, mission §16/§31) - a stale expectedVersion surfaces as a
 * conflict the caller must handle explicitly, never a silent overwrite. */
export function useLinkExpirationItem(subjectId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  return useOccMutation<RequirementAssignmentResponse, LinkVariables>({
    mutationFn: ({ itemId, expectedVersion }) => linkExpirationItem(subjectId, assignmentId, itemId, expectedVersion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["subjects", "requirements", subjectId] });
    },
  });
}
