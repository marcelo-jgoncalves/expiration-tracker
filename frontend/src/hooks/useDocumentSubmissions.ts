import { useQuery } from "@tanstack/react-query";
import { fetchDocumentSubmissions } from "../api/subjects.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { DocumentSubmissionsResponse } from "../api/types.js";

/** Only fetched once the operator actually expands a requirement to review it (`enabled`
 * gate below) - never prefetched for every MISSING assignment on the subject just to render
 * a list, matching the "no speculative reads" discipline the rest of this app already uses. */
export function useDocumentSubmissions(subjectId: string, assignmentId: string, enabled: boolean) {
  return useQuery<DocumentSubmissionsResponse, unknown>({
    queryKey: ["subjects", "submissions", subjectId, assignmentId],
    queryFn: () => fetchDocumentSubmissions(subjectId, assignmentId),
    retry: retryPolicyFor("safe-read"),
    enabled: enabled && subjectId.length > 0 && assignmentId.length > 0,
  });
}
