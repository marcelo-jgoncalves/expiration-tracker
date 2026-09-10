/**
 * Generic per-item document data access (A07, Block 2) - mirrors items.ts's convention (every
 * call site goes through here, matching the real backend paths allowlisted in
 * src/modules/bff/domain/proxy-allowlist.ts). Two real network calls per upload, never one:
 * (1) reserveDocumentUpload (phase 1, this BFF) issues a presigned URL; (2) uploadDocumentBytes
 * (phase 2) PUTs the raw file directly to that URL - never through the BFF/API Gateway, and
 * never merged into a single "upload" function that would hide the two-phase model the audited
 * spec calls out explicitly.
 */
import { apiClient } from "./apiClient.js";
import type { DocumentResponse, DocumentsListResponse, ReserveUploadInput, ReserveUploadResult } from "./types.js";

export function listDocuments(itemId: string, options?: { signal?: AbortSignal }): Promise<DocumentsListResponse> {
  return apiClient.get<DocumentsListResponse>(`/items/${encodeURIComponent(itemId)}/documents`, { signal: options?.signal });
}

export function getDocument(itemId: string, documentId: string, options?: { signal?: AbortSignal }): Promise<DocumentResponse> {
  return apiClient.get<DocumentResponse>(`/items/${encodeURIComponent(itemId)}/documents/${encodeURIComponent(documentId)}`, { signal: options?.signal });
}

export function reserveDocumentUpload(itemId: string, input: ReserveUploadInput, idempotencyKey: string): Promise<ReserveUploadResult> {
  return apiClient.post<ReserveUploadResult>(`/items/${encodeURIComponent(itemId)}/documents`, input, { idempotencyKey });
}

export function deleteDocument(itemId: string, documentId: string): Promise<void> {
  return apiClient.delete<void>(`/items/${encodeURIComponent(itemId)}/documents/${encodeURIComponent(documentId)}`);
}

/** Phase 2 of the two-phase model - a direct-to-storage PUT, deliberately NOT going through
 * `apiClient` (no BFF credentials/CSRF apply to a presigned URL; it is its own auth). Failure
 * here leaves the document in `PENDING_UPLOAD` forever from the backend's point of view until
 * `UploadSlotReconciliationWorker` eventually times it out - the UI's job is only to surface
 * that failure honestly, never to pretend the reservation alone means the file is attached. */
export async function uploadDocumentBytes(uploadUrl: string, requiredHeaders: Record<string, string>, file: File): Promise<void> {
  const response = await fetch(uploadUrl, { method: "PUT", headers: requiredHeaders, body: file });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
}

/** SHA-256 checksum the backend's `ReserveUploadInput.checksumSha256` requires up front (the
 * reservation call happens BEFORE any bytes are sent, so this is computed client-side from the
 * File object itself, not received from a server round-trip). */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  // FileReader rather than `file.arrayBuffer()`/`new Response(file).arrayBuffer()` - both of
  // those are unreliable in this project's jsdom test environment (real browsers implement
  // both fine, but neither actually reads the File's bytes under jsdom - a real gap found
  // while writing this function's own test), while FileReader is well-supported everywhere.
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
