/**
 * Subject/Requirement/DocumentSubmission data access - BLOCKER-C review queue (Variante B).
 * Same one-layer convention as items.ts: every call site goes through these functions, never
 * apiClient inline, so the real backend paths (src/modules/subject/http/{subject,requirement}
 * -handlers.ts, allowlisted in src/modules/bff/domain/proxy-allowlist.ts) exist in exactly
 * one place.
 */
import { apiClient } from "./apiClient.js";
import type {
  CreateSubjectInput,
  DocumentSubmissionsResponse,
  RequirementAssignmentResponse,
  RequirementAssignmentsResponse,
  SubjectResponse,
  SubjectsDashboardResponse,
  TrackedSubjectStatus,
  UpdateSubjectInput,
} from "./types.js";

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

export function fetchRequirementAssignments(subjectId: string, options?: { signal?: AbortSignal }): Promise<RequirementAssignmentsResponse> {
  return apiClient.get<RequirementAssignmentsResponse>(`/subjects/${encodeURIComponent(subjectId)}/requirements`, { signal: options?.signal });
}

export function fetchDocumentSubmissions(subjectId: string, assignmentId: string, options?: { signal?: AbortSignal }): Promise<DocumentSubmissionsResponse> {
  return apiClient.get<DocumentSubmissionsResponse>(`/subjects/${encodeURIComponent(subjectId)}/requirements/${encodeURIComponent(assignmentId)}/submissions`, { signal: options?.signal });
}

/** BLOCKER-C's actual review action: the operator, having seen the uploaded evidence, links
 * an already-existing ExpirationItem to satisfy the requirement (backend re-confirms the
 * item exists via ExpirationItemLookup, never trusts itemId blindly). */
export function linkExpirationItem(subjectId: string, assignmentId: string, itemId: string, expectedVersion: number): Promise<RequirementAssignmentResponse> {
  return apiClient.post<RequirementAssignmentResponse>(`/subjects/${encodeURIComponent(subjectId)}/requirements/${encodeURIComponent(assignmentId)}/link`, { itemId }, { expectedVersion });
}

export function unlinkExpirationItem(subjectId: string, assignmentId: string, expectedVersion: number): Promise<RequirementAssignmentResponse> {
  return apiClient.post<RequirementAssignmentResponse>(`/subjects/${encodeURIComponent(subjectId)}/requirements/${encodeURIComponent(assignmentId)}/unlink`, undefined, { expectedVersion });
}
