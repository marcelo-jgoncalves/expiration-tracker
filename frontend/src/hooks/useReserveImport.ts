/** A15 (Block 9) — "Enviar e continuar" (`import:create`, WRITE_ROLES). Same two-phase shape as
 * `useUploadDocument`: reserve (idempotency-keyed — a retry of the SAME file reuses the same
 * key, so a failed PUT after a successful reserve replays safely onto the same jobId) then PUT
 * the raw bytes directly to storage. No cache to invalidate on success (there is no "list of my
 * import jobs" query — the caller navigates to `/imports/:jobId` and that screen's own
 * `useImportJob()` starts polling fresh). */
import { useIdempotentMutation } from "./useIdempotentMutation.js";
import { computeChecksumSha256, reserveImport, uploadImportBytes } from "../api/imports.js";

interface ReserveImportVariables {
  file: File;
}

export interface ReserveImportResult {
  jobId: string;
}

export const RESERVE_IMPORT_IDEMPOTENCY_STORAGE_KEY = "expiration-tracker:reserve-import:idempotency-key";

export function useReserveImport() {
  return useIdempotentMutation<ReserveImportResult, ReserveImportVariables>({
    persistenceKey: RESERVE_IMPORT_IDEMPOTENCY_STORAGE_KEY,
    mutationFn: async ({ file }, idempotencyKey) => {
      const checksumSha256 = await computeChecksumSha256(file);
      const reservation = await reserveImport({ contentLength: file.size, checksumSha256 }, idempotencyKey);
      await uploadImportBytes(reservation.uploadUrl, reservation.requiredHeaders, file);
      return { jobId: reservation.jobId };
    },
  });
}
