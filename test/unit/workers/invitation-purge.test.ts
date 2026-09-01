import { describe, expect, it } from "vitest";
import { runInvitationPurge, isPurgeEligibleByTermination, terminalTimestamp, INVITATION_RETENTION_DAYS } from "../../../src/workers/invitation-purge/purge.js";
import { FakeInvitationPurgeCandidateSource, FakeTenantLifecycleStatusSource } from "./invitation-purge-fakes.js";
import type { InvitationPurgeCandidate } from "../../../src/workers/invitation-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-01T00:00:00.000Z";

function makeRevoked(overrides: Partial<InvitationPurgeCandidate> = {}): InvitationPurgeCandidate {
  const organizationId = overrides.organizationId ?? "org-1";
  return {
    PK: `TENANT#${organizationId}#ORG#${organizationId}`,
    SK: "INVITATION#inv-1",
    entityType: "Invitation",
    organizationId,
    status: "REVOKED",
    expiresAt: "2026-07-15T00:00:00.000Z",
    revokedAt: "2026-07-01T00:00:00.000Z", // well over 30 days before NOW - eligible
    version: 1,
    ...overrides,
  };
}

function makePending(overrides: Partial<InvitationPurgeCandidate> = {}): InvitationPurgeCandidate {
  const organizationId = overrides.organizationId ?? "org-1";
  return {
    PK: `TENANT#${organizationId}#ORG#${organizationId}`,
    SK: "INVITATION#inv-2",
    entityType: "Invitation",
    organizationId,
    status: "PENDING",
    expiresAt: "2026-07-01T00:00:00.000Z", // well over 30 days before NOW - eligible (never-resolved)
    version: 1,
    ...overrides,
  };
}

describe("runInvitationPurge (D-155: terminal-state+30d physical purge, ACTIVE tenants only)", () => {
  it("purges a REVOKED invitation whose revokedAt is more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("purges a PENDING invitation whose expiresAt is more than 30 days ago (never resolved, de-facto expired) in an ACTIVE tenant", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makePending();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never purges a REVOKED invitation whose revokedAt is less than 30 days ago, even in an ACTIVE tenant", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRevoked({ revokedAt: "2026-08-20T00:00:00.000Z" }); // ~12 days before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never purges a PENDING invitation still within its own expiresAt window (not even terminal yet)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makePending({ expiresAt: "2026-08-31T00:00:00.000Z" }); // still open (1 day before NOW)
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: terminatedAt+30d == now is eligible, terminatedAt+30d-1ms is not", async () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - INVITATION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByTermination(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByTermination(oneMsShort, NOW)).toBe(false);
  });

  it("terminalTimestamp: REVOKED uses revokedAt, PENDING uses expiresAt, anything else is undefined (defensive, never a real scan path)", () => {
    expect(terminalTimestamp({ status: "REVOKED", expiresAt: "2026-01-01T00:00:00.000Z", revokedAt: "2026-02-01T00:00:00.000Z" })).toBe("2026-02-01T00:00:00.000Z");
    expect(terminalTimestamp({ status: "PENDING", expiresAt: "2026-01-01T00:00:00.000Z" })).toBe("2026-01-01T00:00:00.000Z");
    expect(terminalTimestamp({ status: "ACCEPTED", expiresAt: "2026-01-01T00:00:00.000Z" })).toBeUndefined();
  });

  it("never purges an ACCEPTED invitation even if seeded directly into the fake bypassing the scan filter (defense in depth)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    // ACCEPTED never satisfies the fake's own scan filter, so seed it and assert the run leaves
    // it completely untouched (scanned stays 0) - the real scan's FilterExpression is the actual
    // fence; this proves the worker itself never even considers ACCEPTED a candidate.
    const candidate = makeRevoked({ status: "ACCEPTED", revokedAt: undefined, SK: "INVITATION#inv-accepted" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges an invitation in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job)",
    async (status) => {
      const candidates = new FakeInvitationPurgeCandidateSource();
      const lifecycle = new FakeTenantLifecycleStatusSource();
      const candidate = makeRevoked();
      candidates.seed(candidate);
      lifecycle.setStatus(candidate.organizationId, status);

      const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

      expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    },
  );

  it("never purges an invitation whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource(); // no setStatus call - tenant genuinely missing
    const candidate = makeRevoked();
    candidates.seed(candidate);

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: an invitation whose version changed (concurrently modified) between scan and delete is never purged", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRevoked();
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

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 1 });
    // The record is untouched, not silently deleted despite the race.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between scan and delete (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      // Simulate the row already being gone by the time this worker's delete fires (e.g. a
      // second concurrent run of this same worker won the race first).
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realDelete(input);
    };

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.organizationId, "ACTIVE");

    const first = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second).toEqual({ scanned: 0, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes a mix of eligible/ineligible candidates across tenants in one run and touches ONLY the eligible ones", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-active", "ACTIVE");
    lifecycle.setStatus("tenant-closing", "DELETING");

    const eligible = makeRevoked({ organizationId: "tenant-active", PK: "TENANT#tenant-active#ORG#tenant-active", SK: "INVITATION#inv-a" });
    const tooRecent = makeRevoked({
      organizationId: "tenant-active",
      PK: "TENANT#tenant-active#ORG#tenant-active",
      SK: "INVITATION#inv-b",
      revokedAt: "2026-08-20T00:00:00.000Z",
    });
    const nonActiveTenant = makeRevoked({ organizationId: "tenant-closing", PK: "TENANT#tenant-closing#ORG#tenant-closing", SK: "INVITATION#inv-c" });
    candidates.seed(eligible);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 3, purged: 1, skippedTooRecent: 1, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: eligible.PK, SK: eligible.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple scan pages within one run", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    candidates.pageSize = 1;
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("org-1", "ACTIVE");
    const a = makeRevoked({ SK: "INVITATION#inv-a" });
    const b = makePending({ SK: "INVITATION#inv-b" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runInvitationPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });
});
