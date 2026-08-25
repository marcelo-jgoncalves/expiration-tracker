import { useQuery } from "@tanstack/react-query";
import { fetchSubject } from "../api/subjects.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { SubjectResponse } from "../api/types.js";

export function useSubject(subjectId: string) {
  return useQuery<SubjectResponse, unknown>({
    queryKey: ["subjects", "detail", subjectId],
    queryFn: () => fetchSubject(subjectId),
    retry: retryPolicyFor("safe-read"),
    enabled: subjectId.length > 0,
  });
}
