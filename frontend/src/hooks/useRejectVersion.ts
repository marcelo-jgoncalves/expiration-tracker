import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { rejectVersion } from "../api/reviews.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { RejectionReason, ReviewDocumentVersion } from "../api/types.js";

/** A13 (Block 5, D-2xx) - "Rejeitar" (`docarchive:review` + `assertReviewerOrAdmin`). Rejection
 * is a single call, not idempotency-token-protected on the backend (`rejectVersion`'s own
 * signature has no `clientRequestToken`) - OCC (`expectedVersion`) is the only concurrency
 * guard, so this uses the plain `useOccMutation`, same as `useDeleteRequirement`. */
export function useRejectVersion(documentId: string, seq: number) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useOccMutation<{ version: ReviewDocumentVersion }, { expectedVersion: number; reason: RejectionReason }>({
    mutationFn: ({ expectedVersion, reason }) => rejectVersion(documentId, seq, expectedVersion, reason),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.reviewQueue(organizationId, "RECEIVED") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.reviewQueue(organizationId, "UNDER_REVIEW") });
    },
  });
}
