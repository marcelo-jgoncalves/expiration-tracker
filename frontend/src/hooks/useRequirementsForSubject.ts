import { useQuery } from "@tanstack/react-query";
import { fetchRequirementsForSubject } from "../api/requirements.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { STALE_TIME } from "../lib/queryConfig.js";
import type { Requirement } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A09's "Requisitos documentais" card count - `GET /document-archive/requirements/{subjectId}`.
 * PERF-10: OPERATIONAL - a count that moves with normal requirement activity. */
export function useRequirementsForSubject(subjectId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ requirements: Requirement[] }, unknown>({
    queryKey: ["org", organizationId ?? "", "documentArchive", "requirementsForSubject", subjectId] as const,
    queryFn: ({ signal }) => fetchRequirementsForSubject(subjectId, { signal }),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0,
    retry: retryPolicyFor("safe-read"),
    staleTime: STALE_TIME.OPERATIONAL,
  });
}
