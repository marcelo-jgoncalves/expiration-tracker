/**
 * resolveWorkingOrganization — Wave B2B-6 (D-101, physical model §11/§12). Consolidates (and
 * replaces) the 2 checks that used to live separately in `resolve-request-context.ts`
 * (`Membership` `ACTIVE` + the Organization's own `TenantLifecycleRecord` `ACTIVE`) into one
 * shared helper — reused by both the resource-side `RequestContextResolver` and the BFF's
 * `POST /bff/organization/select`, per the Codex Rodada 1 answer to "shared helper or
 * duplicate?": returns a semantic result, never throws the final HTTP error itself, so each
 * caller maps `UNAVAILABLE` to its own shape (403 `OrganizationUnavailableError` on the
 * resource side, a plain JSON response on the BFF side).
 */
import { membershipKey, type Membership } from "../domain/membership.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { OrganizationStore } from "../ports/organization-store.js";

export type WorkingOrganizationResult = { status: "OK"; membership: Membership } | { status: "UNAVAILABLE" };

export async function resolveWorkingOrganization(organizations: OrganizationStore, userId: string, organizationId: string): Promise<WorkingOrganizationResult> {
  const membership = await organizations.get<Membership>(membershipKey(organizationId, userId));
  if (!membership || membership.status !== "ACTIVE") {
    return { status: "UNAVAILABLE" };
  }

  const lifecycle = await organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(organizationId));
  if (!lifecycle || lifecycle.status !== TENANT_ACTIVE_STATUS) {
    return { status: "UNAVAILABLE" };
  }

  return { status: "OK", membership };
}
