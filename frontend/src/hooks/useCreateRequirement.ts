import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRequirement } from "../api/requirements.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateRequirementInput, Requirement } from "../api/types.js";

/** A11 (Block 3, D-2xx) - "Novo requisito" (WRITE_ROLES, `docarchive:requirement-create`).
 * Not idempotent-key-wrapped (unlike item/subject creation) - the backend's `createRequirement`
 * has no idempotency-key contract in `document-archive-handlers.ts` today, so wiring one here
 * would silently claim a guarantee the backend doesn't provide. */
export function useCreateRequirement() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<{ requirement: Requirement }, unknown, CreateRequirementInput>({
    mutationFn: (input) => createRequirement(input),
    onSuccess: () => {
      if (organizationId) {
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirements", "search"] });
      }
    },
  });
}
