/**
 * A09/A11 (Block 3, D-2xx) — `document-archive` module's evidence-backed Requirement
 * (`src/modules/document-archive/http/document-archive-handlers.ts`), a distinct concept from
 * `subjects.ts`'s legacy `RequirementAssignment` (see `types.ts`'s own doc comment on
 * `Requirement`). Same one-layer convention: every call site goes through these functions,
 * never `apiClient` inline.
 */
import { apiClient } from "./apiClient.js";
import { isConflict } from "./errors.js";
import type {
  CreateRequirementInput,
  DossierExportFormat,
  DossierExportRun,
  DossierExportRunStatus,
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

/** A09/A17 (Blocks 3+10, D-2xx) - `docarchive:dossier-export`, ADMIN_ROLES exclusive (D-205).
 * Real 3-step preview/confirm/download flow - generation (PDF/XLSX) and the download route are
 * now both real (D-205 fatia 3, `handleDownloadDossierExport`), confirmed directly against
 * `document-archive-handlers.ts` before building A17 (this comment previously said generation
 * "was not built yet" - that was true when A09's own preview-only stub was written in Block 3,
 * stale by the time A17 shipped in Block 10). */
export interface DossierPreviewRow {
  requirementId: string;
  name: string;
  status: RequirementStatus;
  evidenceValidUntil?: string;
  assigneeUserId?: string;
}
export function previewDossierExport(subjectId: string): Promise<{ run: DossierExportRun; rows: DossierPreviewRow[] }> {
  return apiClient.post<{ run: DossierExportRun; rows: DossierPreviewRow[] }>(`/document-archive/subjects/${encodeURIComponent(subjectId)}/dossier`, undefined);
}

export function confirmDossierExport(subjectId: string, runId: string, scopeHash: string): Promise<{ run: DossierExportRun }> {
  return apiClient.post<{ run: DossierExportRun }>(`/document-archive/subjects/${encodeURIComponent(subjectId)}/dossier/${encodeURIComponent(runId)}/confirm`, { scopeHash });
}

/** `GET .../dossier/{runId}/download?format=pdf|xlsx` - never file bytes, only a freshly minted
 * presigned S3 URL. ALSO doubles as this flow's only status-polling mechanism (there is no
 * dedicated "get run" HTTP route - confirmed directly against `document-archive-handlers.ts`,
 * same real gap this codebase's report-subscription-run download already has): while the run is
 * not yet `READY`, this throws a `ConflictError` whose `details.status` carries the run's real
 * current `DossierExportRunStatus` (`CONFIRMED`/`GENERATING`/`FAILED`/`TOO_LARGE`) -
 * `pollDossierExportRun` below is the only intended caller during the `generating` stage. */
export function downloadDossierExport(
  subjectId: string,
  runId: string,
  format: DossierExportFormat,
  options?: { signal?: AbortSignal },
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  return apiClient.get<{ downloadUrl: string; expiresInSeconds: number }>(
    `/document-archive/subjects/${encodeURIComponent(subjectId)}/dossier/${encodeURIComponent(runId)}/download?format=${format}`,
    { signal: options?.signal },
  );
}

/** Polls run status by attempting the download route and reading the outcome - see
 * `downloadDossierExport`'s own comment for why this is the only real status signal available.
 * Never surfaces the download URL as a side effect of polling (a poll during `generating` should
 * never silently trigger anything download-shaped) - callers that want the URL call
 * `downloadDossierExport` again explicitly once this reports `READY`. */
export async function pollDossierExportRun(subjectId: string, runId: string, options?: { signal?: AbortSignal }): Promise<{ status: DossierExportRunStatus }> {
  try {
    await downloadDossierExport(subjectId, runId, "pdf", options);
    return { status: "READY" };
  } catch (err) {
    if (isConflict(err) && typeof err.details?.["status"] === "string") {
      return { status: err.details["status"] as DossierExportRunStatus };
    }
    throw err;
  }
}
