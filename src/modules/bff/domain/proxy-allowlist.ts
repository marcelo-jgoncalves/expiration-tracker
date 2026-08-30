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
  { method: "POST", pathTemplate: "/items" },
  { method: "GET", pathTemplate: "/items/dashboard" },
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
  { method: "GET", pathTemplate: "/notifications/preferences" },
  { method: "PUT", pathTemplate: "/notifications/preferences" },
  { method: "GET", pathTemplate: "/profile" },
  { method: "PUT", pathTemplate: "/profile" },
  { method: "POST", pathTemplate: "/reminders/policies" },
  { method: "GET", pathTemplate: "/reminders/policies/{policyId}" },
  { method: "PUT", pathTemplate: "/reminders/policies/{policyId}" },
  { method: "POST", pathTemplate: "/reminders/policies/{policyId}/disable" },
  { method: "POST", pathTemplate: "/subjects" },
  { method: "GET", pathTemplate: "/subjects/dashboard" },
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
