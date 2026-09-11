import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createLegacyDocumentRequest } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateLegacyDocumentRequestInput, CreatedLegacyDocumentRequest } from "../api/types.js";

/** A10 (Block 7, D-2xx) - "Solicitar documento" (`requirement:request-document`, WRITE_ROLES).
 * No idempotency-key contract on the backend (`createDocumentRequest` in
 * `document-request-service.ts` takes none). */
export function useCreateLegacyDocumentRequest(subjectId: string, assignmentId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<CreatedLegacyDocumentRequest, unknown, CreateLegacyDocumentRequestInput>({
    mutationFn: (input) => createLegacyDocumentRequest(subjectId, assignmentId, input),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.legacyDocumentRequests(organizationId, subjectId, assignmentId) });
    },
  });
}
