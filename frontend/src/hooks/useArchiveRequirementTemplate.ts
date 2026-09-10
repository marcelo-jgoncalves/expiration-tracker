import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { archiveRequirementTemplate } from "../api/requirementTemplates.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { RequirementTemplate } from "../api/types.js";

/** A21 (Block 4, D-2xx) - "Arquivar" (ADMIN_ROLES, `docarchive:requirementtemplate-archive`) -
 * reversible/non-destructive (SLF-04): an archived template stays read-only for non-admins and
 * un-editable/un-appliable for everyone (including ADMIN+) until "Reativar". */
export function useArchiveRequirementTemplate(templateId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ requirementTemplate: RequirementTemplate }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => archiveRequirementTemplate(templateId, expectedVersion),
    onSuccess: (data) => {
      if (organizationId) {
        queryClient.setQueryData(queryKeys.documentArchive.requirementTemplate(organizationId, templateId), data);
        void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirementTemplates", "list"] });
      }
    },
  });
}
