import { useQuery } from "@tanstack/react-query";
import { listRequirementTemplates } from "../api/requirementTemplates.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { RequirementTemplate, RequirementTemplateStatus } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A21 (Block 4, D-2xx) - catalog list, one status per query (no backend "ALL" mode). */
export function useRequirementTemplates(status: RequirementTemplateStatus, enabled = true) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ requirementTemplates: RequirementTemplate[] }, unknown>({
    queryKey: queryKeys.documentArchive.requirementTemplates(organizationId ?? "", status),
    queryFn: ({ signal }) => listRequirementTemplates(status, { signal }),
    enabled: Boolean(organizationId) && !switching && enabled,
    retry: retryPolicyFor("safe-read"),
  });
}
