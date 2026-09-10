import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { updateRequirementTemplate } from "../api/requirementTemplates.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { RequirementTemplate, UpdateRequirementTemplateInput } from "../api/types.js";

/** A21 (Block 4, D-2xx) - "Editar" (ADMIN_ROLES, `docarchive:requirementtemplate-update`,
 * disabled while ARCHIVED). Also the mechanism behind the ▲/▼ item reorder (a full-array
 * `items` replace, position derived from array order - see this screen's own header comment
 * for why that's a real capability, unlike A20's metadata fields). */
export function useUpdateRequirementTemplate(templateId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ requirementTemplate: RequirementTemplate }, { input: UpdateRequirementTemplateInput; expectedVersion: number }>({
    mutationFn: ({ input, expectedVersion }) => updateRequirementTemplate(templateId, input, expectedVersion),
    onSuccess: (data) => {
      if (organizationId) {
        queryClient.setQueryData(queryKeys.documentArchive.requirementTemplate(organizationId, templateId), data);
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirementTemplates", "list"] });
      }
    },
  });
}
