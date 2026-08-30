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
