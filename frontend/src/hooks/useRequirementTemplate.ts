import { useQuery } from "@tanstack/react-query";
import { fetchRequirementTemplate } from "../api/requirementTemplates.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { RequirementTemplate } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A21 (Block 4, D-2xx) - the detail panel's single-template read, including ARCHIVED (the
 * backend's `getRequirementTemplate` has no status filter of its own - read is READ_ONLY_ROLES
 * regardless of the template's status, per the audited spec). */
export function useRequirementTemplate(templateId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ requirementTemplate: RequirementTemplate }, unknown>({
    queryKey: queryKeys.documentArchive.requirementTemplate(organizationId ?? "", templateId),
    queryFn: ({ signal }) => fetchRequirementTemplate(templateId, { signal }),
    enabled: Boolean(organizationId) && !switching && Boolean(templateId),
    retry: retryPolicyFor("safe-read"),
  });
}
