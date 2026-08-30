/**
 * resolveActiveMembership — Wave B2B-5 (RequestContext Cutover, D-095). Shared by two real
 * callers that both need "the ACTIVE Membership(s) this user has, for real, right now": the
 * identity module's `RequestContextResolver` (asserts exactly one, fails closed otherwise) and
 * the BFF's session self-heal (`BffAuthService` — benignly leaves `activeOrganizationId` unset
 * if zero or more than one, never asserts). Extracted here instead of duplicated in both, and
 * kept separate from `OnboardingStateResolver` (organization/application/onboarding-state.ts,
 * Wave B2B-4/D-094) deliberately — that unit's already-approved contract returns a state, never
 * a Membership, and this wave does not reopen it.
 *
 * Never trusts the GSI4 projection's own `status` — each pointer is hydrated with a strongly
 * consistent `get` against the base partition before its `status` is inspected, same discipline
 * `OnboardingStateResolver` already applies (physical model §6: GSI4 is never a source of
 * authorization).
 */
import { membershipKey, type Membership } from "../domain/membership.js";
import { organizationKey, type Organization } from "../domain/organization.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { OrganizationStore } from "../ports/organization-store.js";

export async function resolveActiveMembership(organizations: OrganizationStore, userId: string): Promise<Membership[]> {
  const pointers = await organizations.queryGsi4<Membership>({ gsi4pk: `USER#${userId}` });
  const hydrated = await Promise.all(pointers.map((pointer) => organizations.get<Membership>(membershipKey(pointer.organizationId, userId))));
  return hydrated.filter((membership): membership is Membership => membership !== undefined && membership.status === "ACTIVE");
}

export interface UsableOrganization {
  organizationId: string;
  displayName: string;
  role: Membership["role"];
  /** Organization's own OCC version (Wave B2B-10) - the frontend needs this as the `If-Match`
   * value for `PATCH /organizations/settings`; every other tenant-scoped write in this app
   * already requires an `expectedVersion`, this list is simply where the frontend's only
   * current source of Organization data already has it available. */
  version: number;
}

/** Wave B2B-6 (D-101, achado 4 da Rodada 1 do Codex): `Membership` `ACTIVE` sozinho não basta -
 * uma organização só é "utilizável" se sua própria `TenantLifecycleRecord` também for `ACTIVE`
 * (physical model §11 exige a checagem dupla). Sem este filtro, `GET /bff/organizations`
 * ofereceria uma organização que `resolveWorkingOrganization()`/`select` rejeitariam depois -
 * uma única fonte de verdade para "quantas organizações utilizáveis" (reaproveitada também pela
 * regra de cardinalidade 0/1/>1 de `resolveSessionWithOnboarding()`). */
export async function listUsableOrganizations(organizations: OrganizationStore, userId: string): Promise<UsableOrganization[]> {
  const memberships = await resolveActiveMembership(organizations, userId);
  const results = await Promise.all(
    memberships.map(async (membership): Promise<UsableOrganization | undefined> => {
      const lifecycle = await organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(membership.organizationId));
      if (!lifecycle || lifecycle.status !== TENANT_ACTIVE_STATUS) return undefined;
      const organization = await organizations.get<Organization>(organizationKey(membership.organizationId));
      if (!organization) return undefined;
      return { organizationId: membership.organizationId, displayName: organization.displayName, role: membership.role, version: organization.version };
    }),
  );
  return results.filter((result): result is UsableOrganization => result !== undefined);
}
