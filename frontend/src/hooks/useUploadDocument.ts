import { useQueryClient } from "@tanstack/react-query";
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { computeChecksumSha256, reserveDocumentUpload, uploadDocumentBytes } from "../api/documents.js";
import { queryKeys } from "../api/queryKeys.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

interface UploadVariables {
  file: File;
}

export interface UploadResult {
  documentId: string;
}

/** Both phases of the two-phase upload model (A07 audited fix) driven by one hook, so every
 * call site gets the full sequence for free - but the two phases stay two real network calls,
 * never collapsed: (1) reserve the slot (idempotency-keyed - a retry of the WHOLE mutation
 * after a failure re-sends the same key, which the backend's IdempotencyStore treats as the
 * same intent rather than a duplicate reservation); (2) PUT the bytes directly to storage. If
 * phase 2 fails after a successful phase 1, retrying this hook re-runs BOTH phases (there is no
 * phase-2-only retry exposed here) - whether that reuses the same document/uploadUrl or mints a
 * new reservation is the backend idempotency store's behavior, not something this hook assumes.
 * Either way the document stays `PENDING_UPLOAD` until the malware-scan pipeline (out of this
 * hook's control) observes the object and advances it - never presented as "done" on reservation
 * alone. `itemId` is a fixed hook argument, not part of the mutation variables - a call site
 * cannot accidentally pass a different item than the one the hook (and its cache invalidation)
 * was created for. */
export function useUploadDocument(itemId: string) {
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  return useIdempotentMutation<UploadResult, UploadVariables>({
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
