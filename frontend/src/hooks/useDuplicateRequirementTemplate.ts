import { useMutation, useQueryClient } from "@tanstack/react-query";
import { duplicateRequirementTemplate } from "../api/requirementTemplates.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { RequirementTemplate } from "../api/types.js";

/** A21 (Block 4, D-2xx) - "Duplicar" (ADMIN_ROLES, `docarchive:requirementtemplate-duplicate`)
 * - ADMIN_ROLES even for an ARCHIVED source template (the audit fix this screen implements:
 * the pre-audit spec wrongly allowed non-admins to duplicate "for reference"). Never available
 * to non-admins regardless of the source's status. */
export function useDuplicateRequirementTemplate(templateId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<{ requirementTemplate: RequirementTemplate }, unknown, { displayName: string }>({
    mutationFn: ({ displayName }) => duplicateRequirementTemplate(templateId, displayName),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirementTemplates", "list"] });
    },
  });
}
