import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRequirement } from "../api/requirements.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateRequirementInput, Requirement } from "../api/types.js";

/** A11 (Block 3, D-2xx) - "Novo requisito" (WRITE_ROLES, `docarchive:requirement-create`).
 * Not idempotent-key-wrapped (unlike item/subject creation) - the backend's `createRequirement`
 * has no idempotency-key contract in `document-archive-handlers.ts` today, so wiring one here
 * would silently claim a guarantee the backend doesn't provide.
 *
 * PERF-10 fix: this used to invalidate only the tenant-wide search index - A09's Compliance
 * panel (`useSubjectCompliance`) and "Requisitos documentais" count (`useRequirementsForSubject`)
 * read the SAME Requirement this creates, scoped by `input.subjectId`, but were never
 * invalidated. Harmless before PERF-10 (staleTime was 0 everywhere, so the next mount always
 * refetched anyway) but a real stale-data bug now that those hooks cache for tens of seconds. */
export function useCreateRequirement() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<{ requirement: Requirement }, unknown, CreateRequirementInput>({
    mutationFn: (input) => createRequirement(input),
    onSuccess: (_data, variables) => {
      if (organizationId) {
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirements", "search"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.subjectCompliance(organizationId, variables.subjectId) });
        void queryClient.invalidateQueries({
          queryKey: ["org", organizationId, "documentArchive", "requirementsForSubject", variables.subjectId],
        });
      }
    },
  });
}
