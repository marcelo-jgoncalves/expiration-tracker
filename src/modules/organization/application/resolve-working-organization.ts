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
import { authorizedTenantIdFromPersistedEntity } from "../../identity/domain/authorization.js";

export type WorkingOrganizationResult = { status: "OK"; membership: Membership } | { status: "UNAVAILABLE" };

// `organizationId` here is the claimed/candidate org (from a selection request, or from
// identity resolution before a RequestContext exists) - this function IS part of the tenant
// resolution machinery (same role as resolve-request-context.ts's own tenantId derivation
// elsewhere): the Membership `ACTIVE` + TenantLifecycleRecord `ACTIVE` double-check below is
// what actually establishes trust, mirroring cancel-organization-closure.ts's identical
// rationale for the one other pre-RequestContext path in this module.
export async function resolveWorkingOrganization(organizations: OrganizationStore, userId: string, organizationId: string): Promise<WorkingOrganizationResult> {
  const tenantId = authorizedTenantIdFromPersistedEntity({ tenantId: organizationId });
  const membership = await organizations.get<Membership>(membershipKey(tenantId, userId));
  if (!membership || membership.status !== "ACTIVE") {
    return { status: "UNAVAILABLE" };
  }

  const lifecycle = await organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(tenantId));
  if (!lifecycle || lifecycle.status !== TENANT_ACTIVE_STATUS) {
    return { status: "UNAVAILABLE" };
  }

  return { status: "OK", membership };
}
