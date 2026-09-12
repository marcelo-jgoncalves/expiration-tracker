/**
 * E-021 (full-audit round2): `hydrateMembershipsFromGsi4` replaces an unbounded `Promise.all`
 * (one concurrent GetItem per organization on every request-context resolution) that used to be
 * duplicated between `onboarding-state.ts` and `resolve-active-membership.ts`. These tests prove
 * the two properties that actually matter for that fix: bounded concurrency, and that a real
 * hydration error still aborts the whole call (never silently treated as "membership doesn't
 * exist" — both callers' cardinality assertions depend on that).
 */
import { describe, expect, it } from "vitest";
import { hydrateMembershipsFromGsi4 } from "../../../src/modules/organization/application/hydrate-memberships.js";
import { membershipGsi4Keys, membershipKey, type Membership } from "../../../src/modules/organization/domain/membership.js";
import type { EntityKey, Gsi4QueryInput, OrganizationStore, TransactWriteEntry } from "../../../src/modules/organization/ports/organization-store.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";

function makePointer(organizationId: string, userId: string): Membership {
  const tenantId = authorizedTenantIdFromPersistedEntity({ tenantId: organizationId });
  return {
    ...membershipKey(tenantId, userId),
    entityType: "Membership",
    membershipId: `mem-${organizationId}-${userId}`,
    organizationId,
    userId,
    role: "MEMBER",
    status: "ACTIVE",
    joinedAt: "2026-08-30T00:00:00.000Z",
    createdBy: userId,
    version: 1,
    ...membershipGsi4Keys(userId, tenantId, `mem-${organizationId}-${userId}`),
  };
}

class TrackingStore implements OrganizationStore {
  inFlight = 0;
  maxInFlight = 0;

  constructor(
    private readonly delayMs: number,
    // PK, not SK — every Membership row for the same user shares the identical SK
    // (`MEMBER#${userId}`, see membershipKey's own doc comment); only PK distinguishes which
    // organization's row this is.
    private readonly failForPk?: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.inFlight -= 1;
    if (this.failForPk && key.PK === this.failForPk) throw new Error(`boom-${key.PK}`);
    return { PK: key.PK, SK: key.SK, entityType: "Membership", status: "ACTIVE" } as unknown as T;
  }

  async putIfAbsent(): Promise<boolean> {
    throw new Error("not used in this test");
  }
  async updateConditional(): Promise<boolean> {
    throw new Error("not used in this test");
  }
  async transactWrite(_entries: TransactWriteEntry[]): Promise<void> {
    throw new Error("not used in this test");
  }
  async queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(): Promise<T[]> {
    throw new Error("not used in this test");
  }
  async queryGsi4<T extends EntityKey = Record<string, unknown> & EntityKey>(_input: Gsi4QueryInput): Promise<T[]> {
    throw new Error("not used in this test");
  }
}

describe("hydrateMembershipsFromGsi4 (E-021)", () => {
  it("never has more than 5 GetItem calls in flight at once, for a user with many organizations", async () => {
    const pointers = Array.from({ length: 12 }, (_, i) => makePointer(`org-${i}`, "user-1"));
    const store = new TrackingStore(5);

    const hydrated = await hydrateMembershipsFromGsi4(store, "user-1", pointers);

    expect(hydrated).toHaveLength(12);
    expect(store.maxInFlight).toBeLessThanOrEqual(5);
    expect(store.maxInFlight).toBeGreaterThan(1); // proves it's genuinely parallel, not serialized
  });

  it("rethrows a real hydration error instead of silently treating it as a missing membership", async () => {
    const pointers = [makePointer("org-1", "user-1"), makePointer("org-2", "user-1"), makePointer("org-3", "user-1")];
    const failingKey = membershipKey(authorizedTenantIdFromPersistedEntity({ tenantId: "org-2" }), "user-1");
    const store = new TrackingStore(1, failingKey.PK);

    await expect(hydrateMembershipsFromGsi4(store, "user-1", pointers)).rejects.toThrow("boom-");
  });

  it("filters out an undefined hydration result (pointer with no live base-partition row)", async () => {
    const org2Key = membershipKey(authorizedTenantIdFromPersistedEntity({ tenantId: "org-2" }), "user-1");
    class SparseStore extends TrackingStore {
      override async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
        if (key.PK === org2Key.PK && key.SK === org2Key.SK) return undefined;
        return super.get(key);
      }
    }
    const pointers = [makePointer("org-1", "user-1"), makePointer("org-2", "user-1")];
    const hydrated = await hydrateMembershipsFromGsi4(new SparseStore(1), "user-1", pointers);
    expect(hydrated).toHaveLength(1);
  });
});
