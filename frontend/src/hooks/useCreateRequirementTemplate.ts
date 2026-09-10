import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRequirementTemplate } from "../api/requirementTemplates.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { CreateRequirementTemplateInput, RequirementTemplate } from "../api/types.js";

/** A21 (Block 4, D-2xx) - "Novo template" (ADMIN_ROLES, `docarchive:requirementtemplate-create`). */
export function useCreateRequirementTemplate() {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<{ requirementTemplate: RequirementTemplate }, unknown, CreateRequirementTemplateInput>({
    mutationFn: (input) => createRequirementTemplate(input),
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirementTemplates", "list"] });
    },
  });
}
