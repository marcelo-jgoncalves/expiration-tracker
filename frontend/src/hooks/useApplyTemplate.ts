import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyTemplate } from "../api/requirementTemplates.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../api/queryKeys.js";
import type { TemplateApplicationResult } from "../api/types.js";

/** A21 (Block 4, D-2xx) - "Confirmar aplicação" (`docarchive:requirementtemplate-apply`,
 * WRITE_ROLES - deliberately a lower tier than catalog administration, since this only creates
 * ordinary operational Requirements). Re-invoking this mutation with the SAME `subjectId` after
 * a partial/unknown-outcome failure IS the spec's "Tentar novamente apenas os pendentes" - the
 * planner (`planTemplateApplication`, shared with preview) reports already-created items as
 * `DUPLICATE_NAME` and skips them, so a retry never duplicates what a prior attempt actually
 * created server-side. On success, invalidates the target Subject's Requirements/compliance so
 * A09/A11 reflect the new Requirements immediately (spec step 4: "retorna... com os Requisitos
 * resultantes visíveis"). */
export function useApplyTemplate(templateId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useMutation<TemplateApplicationResult, unknown, { subjectId: string; expectedTemplateVersion?: number }>({
    mutationFn: ({ subjectId, expectedTemplateVersion }) => applyTemplate(templateId, subjectId, expectedTemplateVersion),
    onSuccess: (_data, variables) => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjects.requirements(organizationId, variables.subjectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.subjectCompliance(organizationId, variables.subjectId) });
      void queryClient.invalidateQueries({ queryKey: ["org", organizationId, "documentArchive", "requirements", "search"] });
    },
  });
}
