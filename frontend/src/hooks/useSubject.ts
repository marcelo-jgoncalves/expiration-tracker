import { useQuery } from "@tanstack/react-query";
import { fetchSubject } from "../api/subjects.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { SubjectResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function useSubject(subjectId: string) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<SubjectResponse, unknown>({
    queryKey: queryKeys.subjects.detail(organizationId ?? "", subjectId),
    queryFn: ({ signal }) => fetchSubject(subjectId, { signal }),
    retry: retryPolicyFor("safe-read"),
    enabled: Boolean(organizationId) && !switching && subjectId.length > 0,
  });
}
