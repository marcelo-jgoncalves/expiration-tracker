/**
 * A15 (Block 9) — CSV bulk import data access, `src/modules/import/http/import-handlers.ts`.
 * Same two-phase upload model as `documents.ts` (reserve → PUT bytes directly to storage) —
 * `uploadDocumentBytes`/`computeChecksumSha256` are reused from there verbatim rather than
 * duplicated (both are already fully generic: `(uploadUrl, requiredHeaders, file)` and
 * `(file) => sha256hex`, neither references anything document-specific).
 */
import { apiClient } from "./apiClient.js";
import { uploadDocumentBytes, computeChecksumSha256 } from "./documents.js";
import type {
  ColumnMapping,
  GetImportJobResult,
  ImportJobSchemaResult,
  ReserveImportInput,
  ReserveImportResult,
  SubmitImportMappingResult,
} from "./types.js";

export { uploadDocumentBytes as uploadImportBytes, computeChecksumSha256 };

export function reserveImport(input: ReserveImportInput, idempotencyKey: string): Promise<ReserveImportResult> {
  return apiClient.post<ReserveImportResult>("/imports", input, { idempotencyKey });
}

export function getImportJob(jobId: string, options?: { signal?: AbortSignal }): Promise<GetImportJobResult> {
  return apiClient.get<GetImportJobResult>(`/imports/${encodeURIComponent(jobId)}`, { signal: options?.signal });
}

export function getImportJobSchema(jobId: string, options?: { signal?: AbortSignal }): Promise<ImportJobSchemaResult> {
  return apiClient.get<ImportJobSchemaResult>(`/import-jobs/${encodeURIComponent(jobId)}/schema`, { signal: options?.signal });
}

export function submitImportMapping(jobId: string, columnMapping: ColumnMapping, expectedVersion: number): Promise<SubmitImportMappingResult> {
  return apiClient.post<SubmitImportMappingResult>(`/import-jobs/${encodeURIComponent(jobId)}/mapping`, { columnMapping }, { expectedVersion });
}

/** 202 Accepted, empty body (`{}`) — the real commit runs async; the caller must poll
 * `getImportJob()` to observe `COMMITTING` → `COMMITTED`/`FAILED` (`ImportHttpDeps.requestCommit`
 * never returns a status itself). */
export function requestImportCommit(jobId: string, expectedVersion: number): Promise<void> {
  return apiClient.post<void>(`/imports/${encodeURIComponent(jobId)}/commit`, undefined, { expectedVersion });
}
