import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { isConflict } from "../api/errors.js";
import { acceptVersion } from "../api/reviews.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

/** A13 (Block 5, D-2xx) - "Aceitar" (`docarchive:review` + `assertReviewerOrAdmin`).
 * `acceptVersion` is idempotent on the backend via `clientRequestToken` (D-143 Decision 2) -
 * uses `useIdempotentMutation` (not the plain OCC hook) so a retry of the SAME decision reuses
 * the same token, never a blind duplicate accept. `isConflict` is re-exported on the result so
 * callers can distinguish "someone else already decided this" (D-143's named OCC scenario) from
 * every other failure, same discipline `useOccMutation` establishes. */
export function useAcceptVersion(documentId: string, seq: number) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  const mutation = useIdempotentMutation<{ document: unknown; acceptedVersionId: string }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }, idempotencyKey) => acceptVersion(documentId, seq, expectedVersion, idempotencyKey),
    onSuccess: () => {
      if (!organizationId) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.reviewQueue(organizationId, "RECEIVED") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.reviewQueue(organizationId, "UNDER_REVIEW") });
    },
  });
  return { ...mutation, isConflict: mutation.isError && isConflict(mutation.error) };
}
