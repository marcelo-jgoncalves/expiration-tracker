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

export function fetchSubjectsDashboard(status: TrackedSubjectStatus): Promise<SubjectsDashboardResponse> {
  return apiClient.get<SubjectsDashboardResponse>(`/subjects/dashboard?status=${encodeURIComponent(status)}`);
}

export function fetchSubject(subjectId: string): Promise<SubjectResponse> {
  return apiClient.get<SubjectResponse>(`/subjects/${encodeURIComponent(subjectId)}`);
}

export function fetchRequirementAssignments(subjectId: string): Promise<RequirementAssignmentsResponse> {
  return apiClient.get<RequirementAssignmentsResponse>(`/subjects/${encodeURIComponent(subjectId)}/requirements`);
}

export function fetchDocumentSubmissions(subjectId: string, assignmentId: string): Promise<DocumentSubmissionsResponse> {
  return apiClient.get<DocumentSubmissionsResponse>(`/subjects/${encodeURIComponent(subjectId)}/requirements/${encodeURIComponent(assignmentId)}/submissions`);
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
