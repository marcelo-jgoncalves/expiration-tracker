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
import type { OrganizationStore } from "../ports/organization-store.js";

export async function resolveActiveMembership(organizations: OrganizationStore, userId: string): Promise<Membership[]> {
  const pointers = await organizations.queryGsi4<Membership>({ gsi4pk: `USER#${userId}` });
  const hydrated = await Promise.all(pointers.map((pointer) => organizations.get<Membership>(membershipKey(pointer.organizationId, userId))));
  return hydrated.filter((membership): membership is Membership => membership !== undefined && membership.status === "ACTIVE");
}
