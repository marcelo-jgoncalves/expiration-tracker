import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { computeChecksumSha256, reserveDocumentUpload, uploadDocumentBytes } from "../api/documents.js";
import { queryKeys } from "../api/queryKeys.js";
import type { DocumentResponse } from "../api/types.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

interface UploadVariables {
  itemId: string;
  file: File;
}

/** Both phases of the two-phase upload model (A07 audited fix) driven by one hook, so every
 * call site gets the full sequence for free - but the two phases stay two real network calls,
 * never collapsed: (1) reserve the slot (idempotency-keyed, safe to retry as the same intent),
 * (2) PUT the bytes directly to storage (NOT idempotency-keyed - a presigned URL is single-use
 * by construction, retrying phase 2 alone on the same reservation is the correct recovery path
 * for a dropped connection, not a duplicate). The document stays `PENDING_UPLOAD` until the
 * malware-scan pipeline (out of this hook's control) observes the object and advances it. */
export function useUploadDocument(itemId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useIdempotentMutation<DocumentResponse["document"] | { documentId: string }, UploadVariables>({
    mutationFn: async ({ file }, idempotencyKey) => {
      const checksumSha256 = await computeChecksumSha256(file);
      const reservation = await reserveDocumentUpload(
        itemId,
        { fileName: file.name, mediaType: file.type, contentLength: file.size, checksumSha256 },
        idempotencyKey,
      );
      await uploadDocumentBytes(reservation.uploadUrl, reservation.requiredHeaders, file);
      return { documentId: reservation.documentId };
    },
    onSuccess: () => {
      if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.items.documents(organizationId, itemId) });
    },
  });
}
