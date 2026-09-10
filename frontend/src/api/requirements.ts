/**
 * A09/A11 (Block 3, D-2xx) — `document-archive` module's evidence-backed Requirement
 * (`src/modules/document-archive/http/document-archive-handlers.ts`), a distinct concept from
 * `subjects.ts`'s legacy `RequirementAssignment` (see `types.ts`'s own doc comment on
 * `Requirement`). Same one-layer convention: every call site goes through these functions,
 * never `apiClient` inline.
 */
import { apiClient } from "./apiClient.js";
import type {
  CreateRequirementInput,
  Requirement,
  RequirementSearchPage,
  RequirementStatus,
  SubjectComplianceSummary,
  UpdateRequirementInput,
} from "./types.js";

export interface RequirementSearchFilters {
  status: RequirementStatus;
  namePrefix?: string;
  assigneeUserId?: string;
  cursor?: string;
}

/** `GET /document-archive/requirements/search` - tenant-wide, `status` is required by the
 * backend (no server-side "ALL" mode, same reasoning as the review queue's `state`) - A11
 * fetches once per selected status tab/filter, never an unfiltered "all statuses" call. */
export function searchRequirements(filters: RequirementSearchFilters, options?: { signal?: AbortSignal }): Promise<RequirementSearchPage> {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.namePrefix) params.set("namePrefix", filters.namePrefix);
  if (filters.assigneeUserId) params.set("assigneeUserId", filters.assigneeUserId);
  if (filters.cursor) params.set("cursor", filters.cursor);
  return apiClient.get<RequirementSearchPage>(`/document-archive/requirements/search?${params.toString()}`, { signal: options?.signal });
}

/** `GET /document-archive/requirements/{subjectId}/compliance` - A09's Compliance panel. */
export function fetchSubjectCompliance(subjectId: string, options?: { signal?: AbortSignal }): Promise<{ compliance: SubjectComplianceSummary }> {
  return apiClient.get<{ compliance: SubjectComplianceSummary }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/compliance`, { signal: options?.signal });
}

export function fetchRequirementsForSubject(subjectId: string, options?: { signal?: AbortSignal }): Promise<{ requirements: Requirement[] }> {
  return apiClient.get<{ requirements: Requirement[] }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}`, { signal: options?.signal });
}

export function createRequirement(input: CreateRequirementInput): Promise<{ requirement: Requirement }> {
  return apiClient.post<{ requirement: Requirement }>("/document-archive/requirements", input);
}

export function updateRequirement(subjectId: string, requirementId: string, input: UpdateRequirementInput, expectedVersion: number): Promise<{ requirement: Requirement }> {
  return apiClient.request<{ requirement: Requirement }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/${encodeURIComponent(requirementId)}`, {
    method: "PATCH",
    body: input,
    expectedVersion,
  });
}

/** `POST .../delete` (not a DELETE verb - matches the real allowlisted route exactly).
 * `docarchive:requirement-delete` is WRITE_ROLES, not ADMIN_ROLES - a deliberate, confirmed
 * exception (see `authorization.ts`'s own tier for this action). */
export function deleteRequirement(subjectId: string, requirementId: string, expectedVersion: number): Promise<void> {
  return apiClient.post<void>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/${encodeURIComponent(requirementId)}/delete`, undefined, { expectedVersion });
}

export function linkEvidence(subjectId: string, requirementId: string, documentId: string, versionId: string, expectedVersion: number): Promise<{ requirement: Requirement }> {
  return apiClient.post<{ requirement: Requirement }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/${encodeURIComponent(requirementId)}/link-evidence`, { documentId, versionId }, { expectedVersion });
}

export function unlinkEvidence(subjectId: string, requirementId: string, expectedVersion: number): Promise<{ requirement: Requirement }> {
  return apiClient.post<{ requirement: Requirement }>(`/document-archive/requirements/${encodeURIComponent(subjectId)}/${encodeURIComponent(requirementId)}/unlink-evidence`, undefined, { expectedVersion });
}
