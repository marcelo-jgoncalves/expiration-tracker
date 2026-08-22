/**
 * Pure validation of an observed S3 object against what was declared at reservation time —
 * M6 design §3.2 (`UploadFinalizerWorker` "confirma bucket, key, tamanho, tipo e metadados
 * esperados; rejeita objeto maior que 10 MB").
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB — capacity-model.md ASSUMPTION closed by M6 design.

export interface DeclaredUpload {
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
}

export interface ObservedUpload {
  mediaType: string;
  contentLength: number;
  checksumSha256?: string;
}

export type UploadValidationResult = "VALID" | "SIZE_MISMATCH" | "SIZE_EXCEEDS_LIMIT" | "MEDIA_TYPE_MISMATCH" | "CHECKSUM_MISMATCH";

export function validateObservedUpload(declared: DeclaredUpload, observed: ObservedUpload): UploadValidationResult {
  if (observed.contentLength > MAX_UPLOAD_BYTES) return "SIZE_EXCEEDS_LIMIT";
  if (observed.contentLength !== declared.contentLength) return "SIZE_MISMATCH";
  if (observed.mediaType !== declared.mediaType) return "MEDIA_TYPE_MISMATCH";
  if (observed.checksumSha256 !== undefined && observed.checksumSha256 !== declared.checksumSha256) return "CHECKSUM_MISMATCH";
  return "VALID";
}
