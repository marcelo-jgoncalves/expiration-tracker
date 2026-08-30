/**
 * Subject/Requirement/DocumentSubmission data access - BLOCKER-C review queue (Variante B).
 * Same one-layer convention as items.ts: every call site goes through these functions, never
 * apiClient inline, so the real backend paths (src/modules/subject/http/{subject,requirement}
 * -handlers.ts, allowlisted in src/modules/bff/domain/proxy-allowlist.ts) exist in exactly
 * one place.
 */
import { apiClient } from "./apiClient.js";
import type {
  DocumentSubmissionsResponse,
  RequirementAssignmentResponse,
  RequirementAssignmentsResponse,
  SubjectResponse,
  SubjectsDashboardResponse,
  TrackedSubjectStatus,
} from "./types.js";

export function fetchSubjectsDashboard(status: TrackedSubjectStatus, options?: { signal?: AbortSignal }): Promise<SubjectsDashboardResponse> {
  return apiClient.get<SubjectsDashboardResponse>(`/subjects/dashboard?status=${encodeURIComponent(status)}`, { signal: options?.signal });
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
