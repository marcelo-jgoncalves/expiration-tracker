/**
 * A13 (Block 5, D-2xx) — Fila de revisão. `document-archive`'s review-queue routes
 * (`src/modules/document-archive/http/document-archive-handlers.ts`,
 * `src/modules/bff/domain/proxy-allowlist.ts`). Same one-layer convention as `requirements.ts`:
 * every call site goes through these functions, never `apiClient` inline.
 */
import { apiClient } from "./apiClient.js";
import type { ReviewQueueHit, ReviewQueueState, ReviewDocumentVersion, RejectionReason } from "./types.js";

/** `GET /document-archive/reviews?state=RECEIVED|UNDER_REVIEW` - `state` is required, one call
 * per state (`ReviewQueueQuery`'s own doc comment: no server-side "ALL" mode, the GSI5 sparse
 * index is partitioned per state). */
export function listReviewQueue(state: ReviewQueueState, cursor?: string, options?: { signal?: AbortSignal }): Promise<{ items: ReviewQueueHit[]; cursor: string | null }> {
  const params = new URLSearchParams({ state });
  if (cursor) params.set("cursor", cursor);
  return apiClient.get<{ items: ReviewQueueHit[]; cursor: string | null }>(`/document-archive/reviews?${params.toString()}`, { signal: options?.signal });
}

/** `POST .../claim` - RECEIVED -> UNDER_REVIEW, `docarchive:review`. `expectedVersion` is sent
 * IN THE BODY (not just the `If-Match` header) - `handleClaimReview` reads `req.body.
 * expectedVersion` directly (schema-validated), same body-carried-OCC shape every
 * document-archive mutation handler in `document-archive-handlers.ts` uses. */
export function claimReview(documentId: string, seq: number, expectedVersion: number): Promise<{ version: ReviewDocumentVersion }> {
  return apiClient.post<{ version: ReviewDocumentVersion }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/claim`, { expectedVersion }, { expectedVersion });
}

/** `POST .../accept` - `docarchive:review` + the service's `assertReviewerOrAdmin` gate.
 * `clientRequestToken` is a real idempotency key (D-143 Decision 2) - callers should generate
 * one per logical decision, same discipline as `useIdempotentMutation.ts` documents. */
export function acceptVersion(documentId: string, seq: number, expectedVersion: number, clientRequestToken: string): Promise<{ document: unknown; acceptedVersionId: string }> {
  return apiClient.post<{ document: unknown; acceptedVersionId: string }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/accept`, { expectedVersion, clientRequestToken }, { expectedVersion });
}

/** `POST .../reject` - `docarchive:review` + `assertReviewerOrAdmin`, closed-taxonomy `reason`. */
export function rejectVersion(documentId: string, seq: number, expectedVersion: number, reason: RejectionReason): Promise<{ version: ReviewDocumentVersion }> {
  return apiClient.post<{ version: ReviewDocumentVersion }>(`/document-archive/documents/${encodeURIComponent(documentId)}/versions/${seq}/reject`, { expectedVersion, reason }, { expectedVersion });
}
