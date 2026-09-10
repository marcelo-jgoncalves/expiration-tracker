/**
 * A12 (Block 5, D-2xx) — mutation hooks for the document-detail screen: the 3-step upload
 * wizard (reserveUpload/reserveFiles/commitUpload) plus the review decisions this screen also
 * surfaces (claim/accept/reject), mirroring A13's `useClaimReview`/`useAcceptVersion`/
 * `useRejectVersion` shape and invalidation discipline exactly, but scoped to THIS document's
 * own detail/version-list keys (not the review-queue tabs — this screen is not the queue).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useOccMutation } from "./useOccMutation.js";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { isConflict } from "../api/errors.js";
import { reserveUpload, reserveFiles, commitUpload, claimReview, acceptVersion, rejectVersion } from "../api/documentArchive.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import type { DocumentArchiveVersion, FileUploadSpec, ReservedDocumentFile, RejectionReason } from "../api/types.js";

function useInvalidateDocument(documentId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return () => {
    if (!organizationId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.document(organizationId, documentId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.documentVersions(organizationId, documentId) });
  };
}

/** Upload step 1/3 - reserve a new DRAFT version. Not OCC (no `expectedVersion` on the request -
 * it creates a new entity), so the plain mutation shape, not `useOccMutation`. */
export function useReserveUpload(documentId: string) {
  const invalidate = useInvalidateDocument(documentId);
  return useOccMutation<{ version: DocumentArchiveVersion }, { origin: "MANUAL_UPLOAD" }>({
    mutationFn: ({ origin }) => reserveUpload(documentId, origin),
    onSuccess: invalidate,
  });
}

/** Upload step 2/3 - reserve + presign the file batch for a DRAFT version. */
export function useReserveFiles(documentId: string, seq: number) {
  return useOccMutation<{ files: ReservedDocumentFile[] }, { expectedVersion: number; files: readonly FileUploadSpec[] }>({
    mutationFn: ({ expectedVersion, files }) => reserveFiles(documentId, seq, expectedVersion, files),
  });
}

/** Upload step 3/3 - commit (DRAFT -> RECEIVED). */
export function useCommitUpload(documentId: string, seq: number) {
  const invalidate = useInvalidateDocument(documentId);
  return useOccMutation<{ version: DocumentArchiveVersion }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => commitUpload(documentId, seq, expectedVersion),
    onSuccess: invalidate,
  });
}

export function useClaimDocumentVersion(documentId: string, seq: number) {
  const invalidate = useInvalidateDocument(documentId);
  return useOccMutation<{ version: DocumentArchiveVersion }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }) => claimReview(documentId, seq, expectedVersion),
    onSuccess: invalidate,
  });
}

/** `acceptVersion` is idempotent on the backend via `clientRequestToken` (D-143 Decision 2) -
 * `useIdempotentMutation`, same discipline as A13's `useAcceptVersion`. */
export function useAcceptDocumentVersion(documentId: string, seq: number) {
  const invalidate = useInvalidateDocument(documentId);
  const mutation = useIdempotentMutation<{ document: unknown; acceptedVersionId: string }, { expectedVersion: number }>({
    mutationFn: ({ expectedVersion }, idempotencyKey) => acceptVersion(documentId, seq, expectedVersion, idempotencyKey),
    onSuccess: invalidate,
  });
  return { ...mutation, isConflict: mutation.isError && isConflict(mutation.error) };
}

export function useRejectDocumentVersion(documentId: string, seq: number) {
  const invalidate = useInvalidateDocument(documentId);
  return useOccMutation<{ version: DocumentArchiveVersion }, { expectedVersion: number; reason: RejectionReason }>({
    mutationFn: ({ expectedVersion, reason }) => rejectVersion(documentId, seq, expectedVersion, reason),
    onSuccess: invalidate,
  });
}
