import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { revokeLegacyDocumentRequest } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export interface RevokeLegacyRequestVariables {
  documentRequestId: string;
  expectedVersion: number;
}

/** A10 (Block 7, D-2xx) - "Revogar" (`requirement:update`, WRITE_ROLES, same tier as edit - see
 * `revokeLegacyDocumentRequest`'s own doc comment in `subjects.ts`). */
export function useRevokeLegacyDocumentRequest(subjectId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<void, RevokeLegacyRequestVariables>({
    mutationFn: ({ documentRequestId, expectedVersion }) => revokeLegacyDocumentRequest(subjectId, documentRequestId, expectedVersion),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.legacyDocumentRequests(organizationId, subjectId, assignmentId) });
    },
  });
}
