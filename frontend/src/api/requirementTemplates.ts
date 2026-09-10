/**
 * A21 (Block 4, D-2xx) - `document-archive` module's `RequirementTemplate` catalog
 * (`src/modules/document-archive/http/document-archive-handlers.ts`). Same one-layer
 * convention as `requirements.ts`/`documentTypes.ts` - every call site goes through these
 * functions, never `apiClient` inline. `expectedVersion` always travels in the JSON body
 * (never the `If-Match` header) - same real contract detail A20's `documentTypes.ts` found by
 * direct inspection of the handlers, confirmed again here for every mutation below.
 */
import { apiClient } from "./apiClient.js";
import type {
  CreateRequirementTemplateInput,
  RequirementTemplate,
  RequirementTemplateStatus,
  TemplateApplicationPreview,
  TemplateApplicationResult,
  UpdateRequirementTemplateInput,
} from "./types.js";

/** `GET /document-archive/requirement-templates?status=` - defaults ACTIVE server-side, same
 * "no unfiltered ALL mode" discipline as `documentTypes.ts`'s `listDocumentTypes`. */
export function listRequirementTemplates(status: RequirementTemplateStatus, options?: { signal?: AbortSignal }): Promise<{ requirementTemplates: RequirementTemplate[] }> {
  return apiClient.get<{ requirementTemplates: RequirementTemplate[] }>(`/document-archive/requirement-templates?status=${status}`, { signal: options?.signal });
}

export function fetchRequirementTemplate(templateId: string, options?: { signal?: AbortSignal }): Promise<{ requirementTemplate: RequirementTemplate }> {
  return apiClient.get<{ requirementTemplate: RequirementTemplate }>(`/document-archive/requirement-templates/${encodeURIComponent(templateId)}`, { signal: options?.signal });
}

export function createRequirementTemplate(input: CreateRequirementTemplateInput): Promise<{ requirementTemplate: RequirementTemplate }> {
  return apiClient.post<{ requirementTemplate: RequirementTemplate }>("/document-archive/requirement-templates", input);
}

export function updateRequirementTemplate(templateId: string, input: UpdateRequirementTemplateInput, expectedVersion: number): Promise<{ requirementTemplate: RequirementTemplate }> {
  return apiClient.request<{ requirementTemplate: RequirementTemplate }>(`/document-archive/requirement-templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    body: { ...input, expectedVersion },
  });
}

/** Always produces a new `ACTIVE`, v1 template, regardless of the source's status (D-2xx audit
 * fix: duplicating an ARCHIVED template stays ADMIN_ROLES-only, never opened to non-admins -
 * this function itself carries no RBAC, the calling screen/backend does). */
export function duplicateRequirementTemplate(templateId: string, displayName: string): Promise<{ requirementTemplate: RequirementTemplate }> {
  return apiClient.post<{ requirementTemplate: RequirementTemplate }>(`/document-archive/requirement-templates/${encodeURIComponent(templateId)}/duplicate`, { displayName });
}

export function archiveRequirementTemplate(templateId: string, expectedVersion: number): Promise<{ requirementTemplate: RequirementTemplate }> {
  return apiClient.post<{ requirementTemplate: RequirementTemplate }>(`/document-archive/requirement-templates/${encodeURIComponent(templateId)}/archive`, { expectedVersion });
}

export function unarchiveRequirementTemplate(templateId: string, expectedVersion: number): Promise<{ requirementTemplate: RequirementTemplate }> {
  return apiClient.post<{ requirementTemplate: RequirementTemplate }>(`/document-archive/requirement-templates/${encodeURIComponent(templateId)}/unarchive`, { expectedVersion });
}

/** POST, read-only (no write quota consumed server-side) - `docarchive:requirementtemplate-read`,
 * READ_ONLY_ROLES. Returns the exact same planner output `apply` will produce if nothing
 * changes between the two calls (declared honesty contract: preview/apply share ONE planner,
 * see `requirement-template.ts`'s own doc comment - they can diverge temporally, never
 * algorithmically). */
export function previewTemplateApplication(templateId: string, subjectId: string): Promise<TemplateApplicationPreview> {
  return apiClient.post<TemplateApplicationPreview>(`/document-archive/requirement-templates/${encodeURIComponent(templateId)}/preview`, { subjectId });
}

/** `docarchive:requirementtemplate-apply`, WRITE_ROLES (deliberately lower than the catalog-
 * admin tier - applying only creates ordinary operational Requirements). `expectedTemplateVersion`
 * is optional: omitting it applies whatever the template's live version currently is; passing
 * the version a preview observed fences the apply against the template moving out from under
 * it between preview and confirm. Re-calling this with the SAME subjectId after a partial/
 * unknown-outcome failure is the real "retry only pending items" flow named in the spec:
 * already-created items surface as `DUPLICATE_NAME` (name-based, `sameTemplateItem: true`) and
 * are skipped, never duplicated - there is no separate "resume" endpoint because none is
 * needed. */
export function applyTemplate(templateId: string, subjectId: string, expectedTemplateVersion?: number): Promise<TemplateApplicationResult> {
  return apiClient.post<TemplateApplicationResult>(`/document-archive/requirement-templates/${encodeURIComponent(templateId)}/apply`, {
    subjectId,
    ...(expectedTemplateVersion !== undefined ? { expectedTemplateVersion } : {}),
  });
}
