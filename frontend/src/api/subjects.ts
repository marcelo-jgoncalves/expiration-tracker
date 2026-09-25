/**
 * TrackedSubject data access. Same one-layer convention as items.ts: every call site goes
 * through these functions, never apiClient inline, so the real backend paths
 * (src/runtime/aws/handlers/subjects-handler.ts, allowlisted in
 * src/modules/bff/domain/proxy-allowlist.ts) exist in exactly one place. ADR-0016 Decision A
 * (2026-09-25) retired this file's own RequirementAssignment/DocumentSubmission/legacy
 * DocumentRequest functions (M9/M10) - A14's document-archive equivalents live in
 * documentRequests.ts, and A22's delivery-preference functions moved there too (Decision B).
 */
import { apiClient } from "./apiClient.js";
import type { CreateSubjectInput, SubjectResponse, SubjectsDashboardResponse, TrackedSubjectStatus, UpdateSubjectInput } from "./types.js";

export function fetchSubjectsDashboard(status: TrackedSubjectStatus, options?: { signal?: AbortSignal }): Promise<SubjectsDashboardResponse> {
  return apiClient.get<SubjectsDashboardResponse>(`/subjects/dashboard?status=${encodeURIComponent(status)}`, { signal: options?.signal });
}

/** A08 (Block 3, D-2xx) - full CRUD, matching `POST /subjects` (`handleCreateSubject`). Takes
 * an idempotency key, same convention as `createItem` (mission §33-35). */
export function createSubject(input: CreateSubjectInput, idempotencyKey: string): Promise<SubjectResponse> {
  return apiClient.post<SubjectResponse>("/subjects", input, { idempotencyKey });
}

/** `PUT /subjects/{subjectId}` (`handleUpdateSubject`) - WRITE_ROLES, OCC via `expectedVersion`. */
export function updateSubject(subjectId: string, input: UpdateSubjectInput, expectedVersion: number): Promise<SubjectResponse> {
  return apiClient.put<SubjectResponse>(`/subjects/${encodeURIComponent(subjectId)}`, input, { expectedVersion });
}

/** `POST /subjects/{subjectId}/archive` - WRITE_ROLES (toggles ACTIVE<->ARCHIVED; "Reativar" and
 * "Arquivar" are the same endpoint, the backend flips status from whatever it currently is). */
export function archiveSubject(subjectId: string, expectedVersion: number): Promise<void> {
  return apiClient.post<void>(`/subjects/${encodeURIComponent(subjectId)}/archive`, undefined, { expectedVersion });
}

/** `DELETE /subjects/{subjectId}` - ADMIN_ROLES only (`subject:delete`). */
export function deleteSubject(subjectId: string, expectedVersion: number): Promise<void> {
  return apiClient.delete<void>(`/subjects/${encodeURIComponent(subjectId)}`, { expectedVersion });
}

export function fetchSubject(subjectId: string, options?: { signal?: AbortSignal }): Promise<SubjectResponse> {
  return apiClient.get<SubjectResponse>(`/subjects/${encodeURIComponent(subjectId)}`, { signal: options?.signal });
}
