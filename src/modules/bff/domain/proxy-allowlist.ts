/**
 * Proxy allowlist — D-053/D-054: the BFF must never become a generic authenticated HTTP
 * proxy. Every route it will forward to the real API is listed here explicitly, mirroring
 * the routes already registered against the JWT-authorizer-protected API Gateway (see the
 * `case "METHOD /path"` switch statements in src/runtime/aws/handlers/*.ts - this list is
 * generated from reading those exhaustively, not invented). `/guest/*` is deliberately
 * excluded: it is already public and has its own token-based validation, outside the BFF's
 * concern entirely (a browser session cookie has no bearing on a guest upload link).
 *
 * Matching is by exact method + templated path segments (`{itemId}` etc.) - never a prefix
 * match, never a wildcard segment, so adding a new backend route requires a deliberate edit
 * here before the BFF will ever forward to it.
 */
export interface AllowlistedRoute {
  method: string;
  /** Path template using the same `{param}` convention as the real API Gateway routes. */
  pathTemplate: string;
}

export const PROXY_ALLOWLIST: readonly AllowlistedRoute[] = [
  // D-149 (admin-activity-log-scoping/estado-final-consolidado.md): tenant-facing read,
  // activity:read RBAC (ADMIN/OWNER) enforced by ActivityService, not by this allowlist.
  { method: "GET", pathTemplate: "/activity" },
  { method: "POST", pathTemplate: "/items" },
  { method: "GET", pathTemplate: "/items/dashboard" },
  // D-194 Fatia 3 (search/filters).
  { method: "GET", pathTemplate: "/items/search" },
  { method: "GET", pathTemplate: "/items/{itemId}" },
  { method: "PUT", pathTemplate: "/items/{itemId}" },
  { method: "DELETE", pathTemplate: "/items/{itemId}" },
  { method: "POST", pathTemplate: "/items/{itemId}/archive" },
  { method: "POST", pathTemplate: "/items/{itemId}/renew" },
  { method: "POST", pathTemplate: "/items/{itemId}/watchers/{userId}" },
  { method: "DELETE", pathTemplate: "/items/{itemId}/watchers/{userId}" },
  { method: "GET", pathTemplate: "/items/{itemId}/watchers" },
  { method: "POST", pathTemplate: "/items/{itemId}/documents" },
  { method: "GET", pathTemplate: "/items/{itemId}/documents" },
  { method: "GET", pathTemplate: "/items/{itemId}/documents/{documentId}" },
  { method: "DELETE", pathTemplate: "/items/{itemId}/documents/{documentId}" },
  { method: "POST", pathTemplate: "/items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm" },
  { method: "POST", pathTemplate: "/items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject" },
  { method: "POST", pathTemplate: "/imports" },
  { method: "GET", pathTemplate: "/imports/{jobId}" },
  { method: "POST", pathTemplate: "/imports/{jobId}/commit" },
  // D-192 slice 9 (bulk-import-documents-requirements-scoping/estado-final-consolidado.md §3).
  { method: "GET", pathTemplate: "/import-jobs/{jobId}/schema" },
  { method: "POST", pathTemplate: "/import-jobs/{jobId}/mapping" },
  { method: "GET", pathTemplate: "/notifications/preferences" },
  { method: "PUT", pathTemplate: "/notifications/preferences" },
  { method: "POST", pathTemplate: "/reminders/policies" },
  { method: "GET", pathTemplate: "/reminders/policies/{policyId}" },
  { method: "PUT", pathTemplate: "/reminders/policies/{policyId}" },
  { method: "POST", pathTemplate: "/reminders/policies/{policyId}/disable" },
  { method: "POST", pathTemplate: "/subjects" },
  { method: "GET", pathTemplate: "/subjects/dashboard" },
  // D-194 Fatia 3 (search/filters).
  { method: "GET", pathTemplate: "/subjects/search" },
  { method: "GET", pathTemplate: "/subjects/document-request-delivery-preference" },
  { method: "PUT", pathTemplate: "/subjects/document-request-delivery-preference" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}" },
  { method: "PUT", pathTemplate: "/subjects/{subjectId}" },
  { method: "DELETE", pathTemplate: "/subjects/{subjectId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/archive" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}" },
  { method: "PUT", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}" },
  { method: "DELETE", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/link" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/unlink" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/submissions" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/submissions/{submissionId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/document-requests" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/requirements/{assignmentId}/document-requests" },
  { method: "GET", pathTemplate: "/subjects/{subjectId}/document-requests/{documentRequestId}" },
  { method: "POST", pathTemplate: "/subjects/{subjectId}/document-requests/{documentRequestId}/revoke" },
  // Wave B2B-8 (D-099).
  { method: "POST", pathTemplate: "/organizations/members/invite" },
  { method: "POST", pathTemplate: "/organizations/invitations/{invitationId}/revoke" },
  { method: "GET", pathTemplate: "/organizations/members" },
  { method: "GET", pathTemplate: "/organizations/invitations" },
  { method: "PUT", pathTemplate: "/organizations/members/{userId}/role" },
  { method: "DELETE", pathTemplate: "/organizations/members/{userId}" },
  { method: "POST", pathTemplate: "/organizations/members/leave" },
  // Wave B2B-10 (Tenant-aware Frontend, "settings" scope item).
  { method: "PATCH", pathTemplate: "/organizations/settings" },
  // W3-07 (D-124): the organization-closure trigger. Must be allowlisted here AND routed in
  // infra/modules/api-gateway/main.tf - D-117/D-120 were both real production bugs where a
  // handler existed and one of the two wiring halves was silently missing.
  { method: "POST", pathTemplate: "/organizations/close" },
  // D-127 (quarantine/recovery window): the cancellation trigger. Same dual-wiring discipline.
  { method: "POST", pathTemplate: "/organizations/cancel-close" },
  // D-143 Nucleus 1 (Document Archive domain) - routed in infra/modules/api-gateway/main.tf's
  // `document_archive_routes` alongside the matching Lambda/IAM wiring in the same PR, so
  // neither half is ever silently missing (the exact D-117/D-120 bug class named above).
  { method: "POST", pathTemplate: "/document-archive/documents" },
  { method: "GET", pathTemplate: "/document-archive/documents/{documentId}" },
  { method: "GET", pathTemplate: "/document-archive/documents/{documentId}/versions" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions" },
  // D-163/D-167: reserveFiles() - found missing during D-177's allowlist read (D-178), the same
  // D-117/D-120 gap class where the resource Lambda route existed but the BFF never proxied it.
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/files" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/commit" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/claim" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/accept" },
  { method: "POST", pathTemplate: "/document-archive/documents/{documentId}/versions/{seq}/reject" },
  // D-143 Nucleus 2, Requirement (Decision 5/D9, D-145) - same pairing discipline as above.
  { method: "POST", pathTemplate: "/document-archive/requirements" },
  // D-194 Fatia 3 (search/filters).
  { method: "GET", pathTemplate: "/document-archive/requirements/search" },
  { method: "GET", pathTemplate: "/document-archive/requirements/{subjectId}" },
  { method: "GET", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}" },
  { method: "PATCH", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}" },
  { method: "POST", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}/link-evidence" },
  { method: "POST", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}/unlink-evidence" },
  { method: "POST", pathTemplate: "/document-archive/requirements/{subjectId}/{requirementId}/delete" },
  // D-143 Nucleus 2, entity 3/3, recurrence (Decision 8/D-147) - same pairing discipline as above.
  { method: "POST", pathTemplate: "/document-archive/series" },
  { method: "GET", pathTemplate: "/document-archive/series/{subjectId}" },
  { method: "GET", pathTemplate: "/document-archive/series/{subjectId}/{seriesId}" },
  { method: "POST", pathTemplate: "/document-archive/series/{subjectId}/{seriesId}/cancel" },
  { method: "POST", pathTemplate: "/document-archive/series/{subjectId}/{seriesId}/materialize" },
  // D-173 (DocumentType catalog), item 5 - same pairing discipline as above.
  { method: "POST", pathTemplate: "/document-archive/document-types" },
  { method: "GET", pathTemplate: "/document-archive/document-types" },
  { method: "GET", pathTemplate: "/document-archive/document-types/{documentTypeId}" },
  { method: "PATCH", pathTemplate: "/document-archive/document-types/{documentTypeId}" },
  { method: "POST", pathTemplate: "/document-archive/document-types/{documentTypeId}/deprecate" },
  { method: "POST", pathTemplate: "/document-archive/document-types/{documentTypeId}/reactivate" },
  // RequirementTemplate (P0.1) — D-117/D-120/D-178 discipline: a route wired in Terraform but
  // absent here is a Lambda nothing can reach through the BFF.
  { method: "POST", pathTemplate: "/document-archive/requirement-templates" },
  { method: "GET", pathTemplate: "/document-archive/requirement-templates" },
  { method: "GET", pathTemplate: "/document-archive/requirement-templates/{templateId}" },
  { method: "PATCH", pathTemplate: "/document-archive/requirement-templates/{templateId}" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/duplicate" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/archive" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/unarchive" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/preview" },
  { method: "POST", pathTemplate: "/document-archive/requirement-templates/{templateId}/apply" },
];

function pathMatchesTemplate(path: string, template: string): boolean {
  const pathSegments = path.split("/").filter(Boolean);
  const templateSegments = template.split("/").filter(Boolean);
  if (pathSegments.length !== templateSegments.length) return false;
  return templateSegments.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg === pathSegments[i]);
}

/** Returns the matched route (so the caller knows the real, un-templated backend path to
 * call) or undefined if this method+path is not explicitly allowlisted. */
export function matchAllowlistedRoute(method: string, path: string): AllowlistedRoute | undefined {
  return PROXY_ALLOWLIST.find((route) => route.method === method.toUpperCase() && pathMatchesTemplate(path, route.pathTemplate));
}
