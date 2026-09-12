/**
 * Shared GSI4 pointer hydration for `OnboardingStateResolver`/`resolveActiveMembership` (E-021,
 * full-audit round2 — both the unbounded fan-out finding and the small duplication finding
 * between the two files close together here). Never trusts GSI4's own `status` (physical model
 * §6) — each pointer is re-read from the base partition via `membershipKey()` (strongly
 * consistent `get`) before its `status` is inspected, same discipline both callers already
 * documented individually.
 *
 * Bounded concurrency (`mapWithConcurrency`) instead of a raw `Promise.all` — this runs on
 * every `RequestContextResolver`/BFF session resolution, so an unbounded fan-out scales with
 * how many organizations a single user belongs to, one concurrent `GetItem` per organization,
 * on every authenticated request. Preserves `Promise.all`'s original fail-fast semantics
 * deliberately: any hydration error is rethrown, never silently swallowed as "membership
 * doesn't exist" — a transient read error must never be mistaken for a real absence by either
 * caller's cardinality assertion.
 */
import { mapWithConcurrency } from "../../../shared/concurrency/map-with-concurrency.js";
import { membershipKey, type Membership } from "../domain/membership.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import { authorizedTenantIdFromPersistedEntity } from "../../identity/domain/authorization.js";

const HYDRATION_CONCURRENCY = 5;

export async function hydrateMembershipsFromGsi4(store: OrganizationStore, userId: string, pointers: readonly Membership[]): Promise<Membership[]> {
  const results = await mapWithConcurrency(pointers, HYDRATION_CONCURRENCY, (pointer) =>
    store.get<Membership>(membershipKey(authorizedTenantIdFromPersistedEntity({ tenantId: pointer.organizationId }), userId)),
  );
  const hydrated: Membership[] = [];
  for (const result of results) {
    if (!result.ok) throw result.error;
    if (result.value !== undefined) hydrated.push(result.value);
  }
  return hydrated;
}
