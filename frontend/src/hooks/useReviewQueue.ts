import { useQuery } from "@tanstack/react-query";
import { listReviewQueue } from "../api/reviews.js";
import { queryKeys } from "../api/queryKeys.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { ReviewQueuePage, ReviewQueueState } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A13 (Block 5, D-2xx) - one independent query per tab/state (`GET .../reviews?state=`), never
 * a merged call - loading/error/cursor are independent per tab, matching `listReviewQueue`'s own
 * doc comment (D-247/D-24x) and `RequirementsCollection`'s established per-status query pattern. */
export function useReviewQueue(state: ReviewQueueState, enabled = true) {
  const { organizationId, switching } = useActiveOrganization();
  return useQuery<ReviewQueuePage, unknown>({
    queryKey: queryKeys.documentArchive.reviewQueue(organizationId ?? "", state),
    queryFn: ({ signal }) => listReviewQueue(state, undefined, { signal }),
    enabled: Boolean(organizationId) && !switching && enabled,
    retry: retryPolicyFor("safe-read"),
  });
}
