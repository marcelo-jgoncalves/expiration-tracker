/**
 * Organization selection endpoints (Wave B2B-6, D-102) - `GET /bff/organizations` and
 * `POST /bff/organization/select` are direct BFF-owned routes (like `/bff/session`), never
 * proxied through `/bff/api/*` - same reason `session.ts` talks to `fetch()` directly instead
 * of `apiClient` (whose `baseUrl` is scoped to the resource proxy only).
 */
import { ApiError } from "./errors.js";
import type { UsableOrganization } from "./session.js";

export interface ListOrganizationsResponse {
  organizations: UsableOrganization[];
}

export async function fetchOrganizations(options?: { signal?: AbortSignal }): Promise<ListOrganizationsResponse> {
  let response: Response;
  try {
    response = await fetch("/bff/organizations", { credentials: "include", signal: options?.signal });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok) {
    throw ApiError.fromResponseBody(await response.json().catch(() => undefined), response.status);
  }
  return (await response.json()) as ListOrganizationsResponse;
}

function readCsrfHeader(): Record<string, string> {
  const csrfCookie = document.cookie.split("; ").find((row) => row.startsWith("__Host-et_csrf="));
  return csrfCookie ? { "x-csrf-token": csrfCookie.split("=")[1] ?? "" } : {};
}

export interface CreateOrganizationResponse {
  organizationId: string;
}

/** `POST /bff/organizations` (Wave B2B-5, D-096) - the one real way out of
 * NO_TENANT_NO_MEMBERSHIP for a freshly-bootstrapped identity. Same direct-fetch/CSRF pattern
 * as `selectOrganization` below (BFF-owned route, never proxied through `/bff/api/*`). */
export async function createOrganization(input: { displayName: string; timezone: string }): Promise<CreateOrganizationResponse> {
  let response: Response;
  try {
    response = await fetch("/bff/organizations", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...readCsrfHeader() },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok) {
    throw ApiError.fromResponseBody(await response.json().catch(() => undefined), response.status);
  }
  return (await response.json()) as CreateOrganizationResponse;
}

export async function selectOrganization(organizationId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/bff/organization/select", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...readCsrfHeader() },
      body: JSON.stringify({ organizationId }),
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok && response.status !== 204) {
    throw ApiError.fromResponseBody(await response.json().catch(() => undefined), response.status);
  }
}

export interface AcceptInvitationResponse {
  organizationId: string;
}

/** `POST /bff/invitations/accept` (Wave B2B-8, D-099 backend; frontend wired in Wave B2B-14,
 * D-120 - the handler/dispatch existed since B2B-8 but no route/page ever called it, found only
 * by trying the real invite flow end-to-end). Identity-only, same direct-fetch/CSRF pattern as
 * `createOrganization`/`selectOrganization` above - requires the caller to already be logged in
 * as the exact invited email (`AcceptInvitationService`'s anti-takeover check), never a tenant
 * context. */
export async function acceptInvitation(token: string): Promise<AcceptInvitationResponse> {
  let response: Response;
  try {
    response = await fetch("/bff/invitations/accept", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...readCsrfHeader() },
      body: JSON.stringify({ token }),
    });
  } catch (cause) {
    throw ApiError.network(cause);
  }
  if (!response.ok) {
    throw ApiError.fromResponseBody(await response.json().catch(() => undefined), response.status);
  }
  return (await response.json()) as AcceptInvitationResponse;
}
