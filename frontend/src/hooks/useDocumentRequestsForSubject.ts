import { useQuery } from "@tanstack/react-query";
import { listDocumentRequests } from "../api/documentRequests.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import { queryKeys } from "../api/queryKeys.js";
import type { DocumentRequest } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A14 (Block 6, D-2xx) - "Solicitações avulsas e materializações" panel, `docarchive:series-read`
 * (all roles) - lists every DocumentRequest under the Subject, avulso and series-materialized
 * alike (`DocumentArchiveService.listDocumentRequests`'s own doc comment). */
export function useDocumentRequestsForSubject(subjectId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<{ documentRequests: DocumentRequest[] }, unknown>({
    queryKey: queryKeys.documentArchive.documentRequests(organizationId ?? "", subjectId),
    queryFn: ({ signal }) => listDocumentRequests(subjectId, { signal }),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0,
    retry: retryPolicyFor("safe-read"),
  });
}
