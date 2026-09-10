import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { unarchiveRequirementTemplate } from "../api/requirementTemplates.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { RequirementTemplate } from "../api/types.js";

/** A21 (Block 4, D-2xx) - "Reativar" (ADMIN_ROLES, `docarchive:requirementtemplate-unarchive`). */
export function useUnarchiveRequirementTemplate(templateId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ requirementTemplate: RequirementTemplate }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => unarchiveRequirementTemplate(templateId, expectedVersion),
    onSuccess: (data) => {
      if (organizationId) {
        queryClient.setQueryData(queryKeys.documentArchive.requirementTemplate(organizationId, templateId), data);
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirementTemplates", "list"] });
      }
    },
  });
}
