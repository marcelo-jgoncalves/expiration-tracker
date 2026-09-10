/**
 * A14 (Block 6, D-2xx) — Solicitações e recorrência. `document-archive`'s series/document-request
 * routes (`src/modules/document-archive/http/document-archive-handlers.ts`, allowlisted in
 * `src/modules/bff/domain/proxy-allowlist.ts`). Same one-layer convention as `reviews.ts`/
 * `documentArchive.ts`: every call site goes through these functions, never `apiClient` inline.
 */
import { apiClient } from "./apiClient.js";
import type { CreateDocumentRequestInput, CreateDocumentRequestSeriesInput, DocumentRequest, DocumentRequestSeries } from "./types.js";

/** `POST /document-archive/requirements/{subjectId}/{requirementId}/document-requests` -
 * `docarchive:request-create`, WRITE_ROLES. Avulso (one-off), outside any series. */
export function createDocumentRequest(input: CreateDocumentRequestInput): Promise<{ documentRequest: DocumentRequest }> {
  const { subjectId, requirementId, ...body } = input;
  return apiClient.post<{ documentRequest: DocumentRequest }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/${encodeURIComponent(requirementId)}/document-requests`, body);
}

/** `GET /document-archive/requirements/{subjectId}/document-requests` - `docarchive:series-read`
 * (all roles, incl. VIEWER) - lists every DocumentRequest under the Subject, avulso and
 * series-materialized alike. */
export function listDocumentRequests(subjectId: string, options?: { signal?: AbortSignal }): Promise<{ documentRequests: DocumentRequest[] }> {
  return apiClient.get<{ documentRequests: DocumentRequest[] }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/document-requests`, { signal: options?.signal });
}

/** `GET .../document-requests/{documentRequestId}` - single-item detail for A14's "Ver" panel. */
export function getDocumentRequest(subjectId: string, documentRequestId: string, options?: { signal?: AbortSignal }): Promise<{ documentRequest: DocumentRequest }> {
  return apiClient.get<{ documentRequest: DocumentRequest }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/document-requests/${encodeURIComponent(documentRequestId)}`, {
    signal: options?.signal,
  });
}

/** `POST /document-archive/series` - `docarchive:series-create`, WRITE_ROLES. */
export function createSeries(input: CreateDocumentRequestSeriesInput): Promise<{ series: DocumentRequestSeries }> {
  return apiClient.post<{ series: DocumentRequestSeries }>("/document-archive/series", input);
}

/** `GET /document-archive/series/{subjectId}` - `docarchive:series-read`, all roles. */
export function listSeries(subjectId: string, options?: { signal?: AbortSignal }): Promise<{ series: DocumentRequestSeries[] }> {
  return apiClient.get<{ series: DocumentRequestSeries[] }>(`/document-archive/series/${encodeURIComponent(subjectId)}`, { signal: options?.signal });
}

/** `GET /document-archive/series/{subjectId}/{seriesId}` - single-series detail, A14's
 * `/series/:seriesId` route. */
export function getSeries(subjectId: string, seriesId: string, options?: { signal?: AbortSignal }): Promise<{ series: DocumentRequestSeries }> {
  return apiClient.get<{ series: DocumentRequestSeries }>(`/document-archive/series/${encodeURIComponent(subjectId)}/${encodeURIComponent(seriesId)}`, { signal: options?.signal });
}

/** `POST .../cancel` - `docarchive:series-cancel`, WRITE_ROLES. `expectedVersion` is body-carried
 * OCC (the module's own convention, never only `If-Match`). */
export function cancelSeries(subjectId: string, seriesId: string, expectedVersion: number): Promise<{ series: DocumentRequestSeries }> {
  return apiClient.post<{ series: DocumentRequestSeries }>(`/document-archive/series/${encodeURIComponent(subjectId)}/${encodeURIComponent(seriesId)}/cancel`, { expectedVersion }, { expectedVersion });
}

/** `POST .../materialize` - `docarchive:series-materialize`, WRITE_ROLES ("Gerar agora"). Backend
 * is idempotent per due cycle (OCC-fenced) - a client-side in-flight guard (the caller's own
 * `pending` state) is still required for the "second click while the first is still in flight"
 * case the backend's per-cycle fencing does not by itself prevent client-side. */
export function materializeSeriesAttempt(subjectId: string, seriesId: string, expectedVersion: number): Promise<{ series: DocumentRequestSeries; request: DocumentRequest }> {
  return apiClient.post<{ series: DocumentRequestSeries; request: DocumentRequest }>(
    `/document-archive/series/${encodeURIComponent(subjectId)}/${encodeURIComponent(seriesId)}/materialize`,
    { expectedVersion },
    { expectedVersion },
  );
}

/** `POST .../recipient` - `docarchive:series-update`, WRITE_ROLES (D-230). `recipientEmail: null`
 * removes it - never an empty string. */
export function updateSeriesRecipient(subjectId: string, seriesId: string, recipientEmail: string | null, expectedVersion: number): Promise<{ series: DocumentRequestSeries }> {
  return apiClient.post<{ series: DocumentRequestSeries }>(
    `/document-archive/series/${encodeURIComponent(subjectId)}/${encodeURIComponent(seriesId)}/recipient`,
    { recipientEmail, expectedVersion },
    { expectedVersion },
  );
}
