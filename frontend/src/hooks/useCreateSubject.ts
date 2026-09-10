/** A08 (Block 3, D-2xx) - "Novo fornecedor" (WRITE_ROLES, `subject:create`). Idempotent, same
 * discipline as `useCreateItem` (a retry of the same submission must reuse the same key). */
import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { createSubject } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateSubjectInput, SubjectResponse } from "../api/types.js";

export const CREATE_SUBJECT_IDEMPOTENCY_STORAGE_KEY = "expiration-tracker:create-subject:idempotency-key";

export function useCreateSubject() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();

  return useIdempotentMutation<SubjectResponse, CreateSubjectInput>({
    persistenceKey: CREATE_SUBJECT_IDEMPOTENCY_STORAGE_KEY,
    mutationFn: (input, key) => createSubject(input, key),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.dashboard(organizationId, "ACTIVE") });
    },
  });
}
