/**
 * A12 (Block 5, D-2xx) — Document Detail / Version History. `document-archive`'s document/version
 * routes (`src/modules/document-archive/http/document-archive-handlers.ts`, allowlisted in
 * `src/modules/bff/domain/proxy-allowlist.ts`). Same one-layer convention as `reviews.ts`: every
 * call site goes through these functions, never `apiClient` inline. Named `documentArchive.ts`
 * (not `documents.ts`) because that filename is already taken by A07's per-item generic document
 * attachments module (`api/documents.ts`) — a different domain, different backend routes.
 */
import { apiClient } from "./apiClient.js";
import type {
  DocumentArchiveDocument,
  DocumentArchiveVersion,
  CreateDocumentInput,
  FileUploadSpec,
  ReservedDocumentFile,
  RejectionReason,
} from "./types.js";

/** `POST /document-archive/documents` - `docarchive:upload`, WRITE_ROLES. */
export function createDocument(input: CreateDocumentInput): Promise<{ document: DocumentArchiveDocument }> {
  return apiClient.post<{ document: DocumentArchiveDocument }>("/document-archive/documents", input);
}

/** `GET /document-archive/documents/{documentId}` - `docarchive:read`, all roles. */
export function getDocument(documentId: string, options?: { signal?: AbortSignal }): Promise<{ document: DocumentArchiveDocument }> {
  return apiClient.get<{ document: DocumentArchiveDocument }>(`/document-archive/documents/${encodeURIComponent(documentId)}`, { signal: options?.signal });
}

/** `GET /document-archive/documents/{documentId}/versions` - `docarchive:read`. Returns every
 * version (all states), newest-seq-first is the UI's own rendering concern, not guaranteed by
 * the backend response order. */
export function listDocumentVersions(documentId: string, options?: { signal?: AbortSignal }): Promise<{ versions: DocumentArchiveVersion[] }> {
  return apiClient.get<{ versions: DocumentArchiveVersion[] }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions`, { signal: options?.signal });
}

/** Upload step 1/3 — `POST .../versions` reserves a new DRAFT version. `docarchive:upload`. */
export function reserveUpload(documentId: string, origin: "MANUAL_UPLOAD"): Promise<{ version: DocumentArchiveVersion }> {
  return apiClient.post<{ version: DocumentArchiveVersion }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions`, { origin });
}

/** Upload step 2/3 — `POST .../versions/{seq}/files` reserves + presigns the file batch (exactly
 * one PRINCIPAL). `expectedVersion` travels in the body (OCC), same body-carried convention every
 * document-archive mutation handler uses (`reviews.ts`'s own doc comment). Bytes are then PUT
 * directly to each `uploadUrl` by the caller, never through this function/the BFF. */
export function reserveFiles(documentId: string, seq: number, expectedVersion: number, files: readonly FileUploadSpec[]): Promise<{ files: ReservedDocumentFile[] }> {
  return apiClient.post<{ files: ReservedDocumentFile[] }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/files`, { expectedVersion, files }, { expectedVersion });
}

/** Upload step 3/3 — `POST .../versions/{seq}/commit` seals the version, DRAFT -> RECEIVED. */
export function commitUpload(documentId: string, seq: number, expectedVersion: number): Promise<{ version: DocumentArchiveVersion }> {
  return apiClient.post<{ version: DocumentArchiveVersion }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/commit`, { expectedVersion }, { expectedVersion });
}

/** `POST .../claim` - RECEIVED -> UNDER_REVIEW, `docarchive:review`. */
export function claimReview(documentId: string, seq: number, expectedVersion: number): Promise<{ version: DocumentArchiveVersion }> {
  return apiClient.post<{ version: DocumentArchiveVersion }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/claim`, { expectedVersion }, { expectedVersion });
}

/** `POST .../accept` - `docarchive:review` + `assertReviewerOrAdmin`. `clientRequestToken` is a
 * real idempotency key (D-143 Decision 2), same discipline `reviews.ts`'s `acceptVersion` uses. */
export function acceptVersion(documentId: string, seq: number, expectedVersion: number, clientRequestToken: string): Promise<{ document: DocumentArchiveDocument; acceptedVersionId: string }> {
  return apiClient.post<{ document: DocumentArchiveDocument; acceptedVersionId: string }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/accept`, { expectedVersion, clientRequestToken }, { expectedVersion });
}

/** `POST .../reject` - `docarchive:review` + `assertReviewerOrAdmin`, closed-taxonomy `reason`. */
export function rejectVersion(documentId: string, seq: number, expectedVersion: number, reason: RejectionReason): Promise<{ version: DocumentArchiveVersion }> {
  return apiClient.post<{ version: DocumentArchiveVersion }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/reject`, { expectedVersion, reason }, { expectedVersion });
}

/** Direct-to-storage PUT for one reserved file's bytes — mirrors `api/documents.ts`'s
 * `uploadDocumentBytes` exactly (never through `apiClient`, presigned URL is its own auth). */
export async function uploadFileBytes(uploadUrl: string, requiredHeaders: Record<string, string>, file: File): Promise<void> {
  const response = await fetch(uploadUrl, { method: "PUT", headers: requiredHeaders, body: file });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
}

/** SHA-256 checksum, `FileUploadSpec.checksumSha256` — mirrors `api/documents.ts`'s
 * `computeChecksumSha256` (FileReader, not `file.arrayBuffer()`, for jsdom test compatibility). */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.readAsArrayBuffer(file);
  });
}

export async function computeChecksumSha256(file: File): Promise<string> {
  const buffer = await readAsArrayBuffer(file);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
