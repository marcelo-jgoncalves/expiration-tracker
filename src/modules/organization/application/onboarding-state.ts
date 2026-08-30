/**
 * OnboardingStateResolver — Wave B2B-4 (docs/architecture/multi-user-b2b-wave-b2b4-scope.md,
 * `APPROVED` D-092/D-093). Pure classifier: NOT wired into `bootstrap-identity.ts`/
 * `resolve-request-context.ts`/`bff-auth-service.ts` (that wiring, plus removing the legacy
 * auto-provision, is Wave B2B-5), and NOT exposed over HTTP (no consumer exists yet — the
 * scope doc's Rodada 1 finding was that an HTTP surface without a real caller is itself a
 * defect, not a safety margin).
 *
 * Strict sequential procedure (order matters — these are not independent parallel
 * conditions), per the scope doc's Rodada 4 closing text:
 *   1. Any Membership ACTIVE (any org)              -> HAS_USABLE_MEMBERSHIP (unconditional —
 *      wins even with other SUSPENDED/REMOVED memberships present)
 *   2. No ACTIVE, but some SUSPENDED                 -> SUSPENDED_ONLY
 *   3. No ACTIVE nor SUSPENDED (only REMOVED/none)   -> REMOVED is ignored (re-joining via a
 *      future invitation must stay possible, physical model §5) — fall through to 4-5
 *   4. Legacy TenantLifecycleRecord exists (tenantId=userId) -> LEGACY_TENANT_ONLY (the real
 *      state of every user today, pre-B2B-5 cutover)
 *   5. Neither                                       -> NO_TENANT_NO_MEMBERSHIP (only reachable
 *      for real once B2B-5 stops auto-provisioning the legacy tenant — synthetic fixture only
 *      for now, legitimate per Rodada 2 of the scope debate)
 *
 * Memberships are discovered via `OrganizationStore.queryGsi4()` (`MembershipByUser`) but never
 * trusted from that projection directly: GSI4 is eventually consistent and physical model §6 is
 * explicit that it must never be an authorization source. Each pointer is re-read from the base
 * partition via `membershipKey()` (strongly consistent `get`, same guarantee `organization-store.ts`
 * documents) before its `status` is inspected — "hydration", not a raw GSI4 read.
 */
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { membershipKey, type Membership } from "../domain/membership.js";
import type { OrganizationStore } from "../ports/organization-store.js";

export type OnboardingState = "HAS_USABLE_MEMBERSHIP" | "SUSPENDED_ONLY" | "LEGACY_TENANT_ONLY" | "NO_TENANT_NO_MEMBERSHIP";

export class OnboardingStateResolver {
  constructor(private readonly store: OrganizationStore) {}

  async resolve(userId: string): Promise<OnboardingState> {
    const pointers = await this.store.queryGsi4<Membership>({ gsi4pk: `USER#${userId}` });

    const hydrated = await Promise.all(pointers.map((pointer) => this.store.get<Membership>(membershipKey(pointer.organizationId, userId))));
    const memberships = hydrated.filter((membership): membership is Membership => membership !== undefined);

    if (memberships.some((membership) => membership.status === "ACTIVE")) {
      return "HAS_USABLE_MEMBERSHIP";
    }
    if (memberships.some((membership) => membership.status === "SUSPENDED")) {
      return "SUSPENDED_ONLY";
    }

    const legacy = await this.store.get<TenantLifecycleRecord>(tenantLifecycleKey(userId));
    if (legacy) {
      return "LEGACY_TENANT_ONLY";
    }

    return "NO_TENANT_NO_MEMBERSHIP";
  }
}
