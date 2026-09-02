import { describe, expect, it } from "vitest";
import { runMembershipPurge, isPurgeEligibleByRemoval, MEMBERSHIP_RETENTION_DAYS } from "../../../src/workers/membership-purge/purge.js";
import { FakeMembershipPurgeCandidateSource, FakeTenantLifecycleStatusSource } from "./membership-purge-fakes.js";
import type { MembershipPurgeCandidate } from "../../../src/workers/membership-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-02T00:00:00.000Z";

function makeRemoved(overrides: Partial<MembershipPurgeCandidate> = {}): MembershipPurgeCandidate {
  const organizationId = overrides.organizationId ?? "org-1";
  return {
    PK: `TENANT#${organizationId}#ORG#${organizationId}`,
    SK: "MEMBER#user-1",
    entityType: "Membership",
    organizationId,
    status: "REMOVED",
    removedAt: "2026-07-01T00:00:00.000Z", // well over 30 days before NOW - eligible
    version: 1,
    ...overrides,
  };
}

describe("runMembershipPurge (D-127 Prioridade 5, Membership leg, unblocked by D-158's removedAt)", () => {
  it("purges a REMOVED membership whose removedAt is more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never purges a REMOVED membership whose removedAt is less than 30 days ago, even in an ACTIVE tenant", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved({ removedAt: "2026-08-20T00:00:00.000Z" }); // ~13 days before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: removedAt+30d == now is eligible, removedAt+30d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - MEMBERSHIP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByRemoval(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByRemoval(oneMsShort, NOW)).toBe(false);
  });

  it("never purges an ACTIVE membership even if seeded directly into the fake bypassing the scan filter (defense in depth)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved({ status: "ACTIVE", removedAt: undefined, SK: "MEMBER#user-active" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never purges a SUSPENDED membership even if seeded directly into the fake (reversible, not a termination)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved({ status: "SUSPENDED", removedAt: undefined, SK: "MEMBER#user-suspended" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never purges a REMOVED membership with no removedAt at all (pre-D-158 row, fail-closed defense in depth)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved({ removedAt: undefined });
    // Bypass the fake's own scan filter (which requires removedAt !== undefined) by seeding then
    // asserting the scan itself never surfaces it - same defense-in-depth style as the sibling
    // "ACCEPTED never a candidate" test in invitation-purge.
    candidates.seed(candidate);

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a membership in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job)",
    async (status) => {
      const candidates = new FakeMembershipPurgeCandidateSource();
      const lifecycle = new FakeTenantLifecycleStatusSource();
      const candidate = makeRemoved();
      candidates.seed(candidate);
      lifecycle.setStatus(candidate.organizationId, status);

      const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

      expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    },
  );

  it("never purges a membership whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource(); // no setStatus call - tenant genuinely missing
    const candidate = makeRemoved();
    candidates.seed(candidate);

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a membership whose version changed (concurrently modified) between scan and delete is never purged", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    // Simulate a concurrent write racing this worker: version bumps on the underlying row AFTER
    // the scan already produced `candidate`, but BEFORE this worker's delete call fires.
    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2;
      return realDelete(input);
    };

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 1 });
    // The record is untouched, not silently deleted despite the race.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between scan and delete (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      // Simulate the row already being gone by the time this worker's delete fires (e.g. a
      // second concurrent run of this same worker won the race first).
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realDelete(input);
    };

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const first = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second).toEqual({ scanned: 0, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes a mix of eligible/ineligible candidates across tenants in one run and touches ONLY the eligible ones", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-active", "ACTIVE");
    lifecycle.setStatus("tenant-closing", "DELETING");

    const eligible = makeRemoved({ organizationId: "tenant-active", PK: "TENANT#tenant-active#ORG#tenant-active", SK: "MEMBER#user-a" });
    const tooRecent = makeRemoved({
      organizationId: "tenant-active",
      PK: "TENANT#tenant-active#ORG#tenant-active",
      SK: "MEMBER#user-b",
      removedAt: "2026-08-20T00:00:00.000Z",
    });
    const nonActiveTenant = makeRemoved({ organizationId: "tenant-closing", PK: "TENANT#tenant-closing#ORG#tenant-closing", SK: "MEMBER#user-c" });
    candidates.seed(eligible);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 3, purged: 1, skippedTooRecent: 1, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: eligible.PK, SK: eligible.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple scan pages within one run", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    candidates.pageSize = 1;
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("org-1", "ACTIVE");
    const a = makeRemoved({ SK: "MEMBER#user-a" });
    const b = makeRemoved({ SK: "MEMBER#user-b" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runMembershipPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });
});
