/**
 * OnboardingStateResolver — Wave B2B-4 (docs/architecture/multi-user-b2b-wave-b2b4-scope.md,
 * `APPROVED` D-092/D-093). Pure classifier, wired into `resolve-request-context.ts`/
 * `bff-auth-service.ts` since Wave B2B-5.
 *
 * Strict sequential procedure (order matters — these are not independent parallel
 * conditions), per the scope doc's Rodada 4 closing text (the legacy TenantLifecycleRecord
 * step, `tenantId=userId`, was removed in Wave B2B-12/D-110 once the dev cutover confirmed no
 * production path creates that record anymore — see multi-user-b2b-wave-b2b12-scope.md):
 *   1. Any Membership ACTIVE (any org)              -> HAS_USABLE_MEMBERSHIP (unconditional —
 *      wins even with other SUSPENDED/REMOVED memberships present)
 *   2. No ACTIVE, but some SUSPENDED                 -> SUSPENDED_ONLY
 *   3. Neither                                       -> NO_TENANT_NO_MEMBERSHIP (REMOVED is
 *      ignored here too — re-joining via a future invitation must stay possible, physical
 *      model §5)
 *
 * Memberships are discovered via `OrganizationStore.queryGsi4()` (`MembershipByUser`) but never
 * trusted from that projection directly: GSI4 is eventually consistent and physical model §6 is
 * explicit that it must never be an authorization source. Each pointer is re-read from the base
 * partition via `membershipKey()` (strongly consistent `get`, same guarantee `organization-store.ts`
 * documents) before its `status` is inspected — "hydration", not a raw GSI4 read. Hydration itself
 * is `hydrateMembershipsFromGsi4()` (shared with `resolve-active-membership.ts`, E-021 full-audit
 * round2 — this used to be an unbounded `Promise.all`, one concurrent GetItem per organization on
 * every request-context resolution).
 */
import type { Membership } from "../domain/membership.js";
import type { OrganizationStore } from "../ports/organization-store.js";
import { hydrateMembershipsFromGsi4 } from "./hydrate-memberships.js";

export type OnboardingState = "HAS_USABLE_MEMBERSHIP" | "SUSPENDED_ONLY" | "NO_TENANT_NO_MEMBERSHIP";

export class OnboardingStateResolver {
  constructor(private readonly store: OrganizationStore) {}

  async resolve(userId: string): Promise<OnboardingState> {
    const pointers = await this.store.queryGsi4<Membership>({ gsi4pk: `USER#${userId}` });
    const memberships = await hydrateMembershipsFromGsi4(this.store, userId, pointers);

    if (memberships.some((membership) => membership.status === "ACTIVE")) {
      return "HAS_USABLE_MEMBERSHIP";
    }
    if (memberships.some((membership) => membership.status === "SUSPENDED")) {
      return "SUSPENDED_ONLY";
    }

    return "NO_TENANT_NO_MEMBERSHIP";
  }
}
