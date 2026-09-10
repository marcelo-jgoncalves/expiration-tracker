import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { claimReview } from "../api/reviews.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A13 (Block 5, D-2xx) - "Reivindicar" (`docarchive:review`, WRITE_ROLES; only offered while
 * `reviewer === "—"`, RECEIVED tab only per the audited spec). Invalidates BOTH review-queue
 * tabs - a successful claim moves the item from RECEIVED to UNDER_REVIEW, so both lists are
 * stale, not just the one the request was made from. */
export function useClaimReview(documentId: string, seq: number) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ version: unknown }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => claimReview(documentId, seq, expectedVersion),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.reviewQueue(organizationId, "RECEIVED") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.reviewQueue(organizationId, "UNDER_REVIEW") });
    },
  });
}
