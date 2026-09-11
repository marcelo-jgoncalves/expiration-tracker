import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { linkExpirationItem } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import type { RequirementAssignmentResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

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
  const { organizationId } = useActiveOrganization();
  return useOccMutation<RequirementAssignmentResponse, LinkVariables>({
    mutationFn: ({ itemId, expectedVersion }) => linkExpirationItem(subjectId, assignmentId, itemId, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.requirements(organizationId, subjectId) });
      // A10 (Block 7, D-2xx) - this mutation is now also reachable from the assignment detail
      // page (Snapshot's "Vincular item"), not just the BLOCKER-C list this hook originated in.
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.assignmentDetail(organizationId, subjectId, assignmentId) });
    },
  });
}
