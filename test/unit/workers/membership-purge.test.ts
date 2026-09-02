import { describe, expect, it } from "vitest";
import { runMembershipPurge, isPurgeEligibleByRemoval, MEMBERSHIP_RETENTION_DAYS } from "../../../src/workers/membership-purge/purge.js";
import { FakeMembershipPurgeCandidateSource } from "./membership-purge-fakes.js";
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
    membershipId: overrides.membershipId ?? "membership-user-1",
    status: "REMOVED",
    removedAt: "2026-07-01T00:00:00.000Z", // well over 30 days before NOW - eligible
    version: 1,
    ...overrides,
  };
}

describe("runMembershipPurge (D-127 Prioridade 5 / D-179-D-180 MaintenanceDueIndex pilot slice)", () => {
  it("purges a REMOVED membership whose removedAt is more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(0);
    expect(result.quarantinedCount).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never surfaces a REMOVED membership whose removedAt is less than 30 days ago as a candidate at all (GSI8 is due-ordered, unlike the old Scan)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved({ removedAt: "2026-08-20T00:00:00.000Z" }); // ~13 days before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: removedAt+30d == now is eligible, removedAt+30d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - MEMBERSHIP_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByRemoval(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByRemoval(oneMsShort, NOW)).toBe(false);
  });

  it("never indexes (and never purges) an ACTIVE membership, even seeded directly (defense in depth)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved({ status: "ACTIVE", removedAt: undefined, SK: "MEMBER#user-active" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never indexes (and never purges) a SUSPENDED membership (reversible, not a termination)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved({ status: "SUSPENDED", removedAt: undefined, SK: "MEMBER#user-suspended" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never indexes a REMOVED membership with no removedAt at all (pre-D-158 row, fail-closed defense in depth)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved({ removedAt: undefined });
    candidates.seed(candidate);

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a membership in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job) and increments the retry counter",
    async (status) => {
      const candidates = new FakeMembershipPurgeCandidateSource();
      const candidate = makeRemoved();
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.organizationId, status);

      const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result).toMatchObject({ scanned: 1, purged: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0, quarantinedCount: 0 });
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
      expect(stored).toBeDefined();
      expect(stored?.["maintenanceAttemptCount"]).toBe(1);
      expect(stored?.["GSI8PK"]).toBe("WORK#MEMBERSHIP_PURGE"); // still in WORK namespace, not DLQ yet
    },
  );

  it("never purges a membership whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource(); // no setTenantStatus call - tenant genuinely missing
    const candidate = makeRemoved();
    candidates.seed(candidate);

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a membership whose version changed (concurrently modified) between revalidation and claim is never purged", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    // Simulate a concurrent write racing this worker: version bumps on the underlying row AFTER
    // getMembership() already returned a snapshot, but BEFORE this worker's transactWrite fires.
    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2;
      return realTransactWrite(entries);
    };

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    // The record is untouched, not silently deleted despite the race.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between revalidation and claim (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      // Simulate the row already being gone by the time this worker's transaction fires (e.g. a
      // second concurrent run of this same worker won the race first).
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realTransactWrite(entries);
    };

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const first = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
  });

  it("processes a mix of eligible/blocked candidates across tenants in one run and touches ONLY the ones GSI8 actually surfaces", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    candidates.setTenantStatus("tenant-active", "ACTIVE");
    candidates.setTenantStatus("tenant-closing", "DELETING");

    const eligible = makeRemoved({ organizationId: "tenant-active", PK: "TENANT#tenant-active#ORG#tenant-active", SK: "MEMBER#user-a", membershipId: "membership-user-a" });
    const tooRecent = makeRemoved({
      organizationId: "tenant-active",
      PK: "TENANT#tenant-active#ORG#tenant-active",
      SK: "MEMBER#user-b",
      membershipId: "membership-user-b",
      removedAt: "2026-08-20T00:00:00.000Z",
    });
    const nonActiveTenant = makeRemoved({ organizationId: "tenant-closing", PK: "TENANT#tenant-closing#ORG#tenant-closing", SK: "MEMBER#user-c", membershipId: "membership-user-c" });
    candidates.seed(eligible);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    // tooRecent never appears in GSI8's `GSI8SK < now` query at all - not "scanned and skipped".
    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(1);
    expect(candidates.get({ PK: eligible.PK, SK: eligible.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple GSI8 pages within one run", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    candidates.pageSize = 1;
    candidates.setTenantStatus("org-1", "ACTIVE");
    const a = makeRemoved({ SK: "MEMBER#user-a", membershipId: "membership-user-a" });
    const b = makeRemoved({ SK: "MEMBER#user-b", membershipId: "membership-user-b" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });

  it("reports the age of the oldest due candidate without extra I/O", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    candidates.setTenantStatus("org-1", "ACTIVE");
    // removedAt+30d = 2026-07-31T00:00:00.000Z, which is 33 days (2851200s) before NOW (2026-09-02).
    candidates.seed(makeRemoved({ removedAt: "2026-07-01T00:00:00.000Z" }));

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.oldestCandidateAgeSeconds).toBe(33 * 24 * 60 * 60);
  });

  it("reports undefined oldestCandidateAgeSeconds when there is nothing due", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(result.oldestCandidateAgeSeconds).toBeUndefined();
  });

  // D-179 §8 poison-record handling: a candidate whose tenant never returns to ACTIVE keeps
  // failing the atomic ConditionCheck every run. Mutação: removing the MAX_ATTEMPTS gate (or the
  // GSI8PK swap to the DLQ namespace) would leave this row reappearing in the WORK query forever.
  it("quarantines a candidate to the DLQ namespace after MAX_ATTEMPTS failed tenant-ACTIVE revalidations", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "BLOCKED");

    // Each failed attempt pushes GSI8SK forward by a capped exponential backoff (1,2,4,8,16
    // days) - `now` must advance past that backoff each run, exactly as a real daily-cadence
    // worker's clock would across many scheduled invocations, for the row to reappear as due.
    let now = Date.parse(NOW);
    let last;
    for (let i = 0; i < 6; i++) {
      now += 20 * 24 * 60 * 60 * 1000; // 20 days - comfortably past the largest (16d) backoff step
      const nowIso = new Date(now).toISOString();
      last = await runMembershipPurge({ candidates, tableName: TABLE, now: () => nowIso });
    }

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBe("DLQ#MEMBERSHIP_PURGE");
    expect(stored?.["maintenanceAttemptCount"]).toBe(6);
    expect(last!.quarantinedCount).toBe(1);
    // Once quarantined, the DLQ namespace is never queried by WORK#MEMBERSHIP_PURGE again -
    // a subsequent run finds nothing to scan for this candidate.
    const after = await runMembershipPurge({ candidates, tableName: TABLE, now: () => new Date(now + 1000).toISOString() });
    expect(after.scanned).toBe(0);
  });

  // D-179 §4/§7 self-heal: a Membership reactivated after being indexed (e.g. rejoin via
  // invite) must never keep reappearing as a false candidate.
  it("self-heals a stale GSI8 pointer left on a membership that is no longer REMOVED", async () => {
    const candidates = new FakeMembershipPurgeCandidateSource();
    const candidate = makeRemoved({ membershipId: "membership-stale" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");
    // Simulate accept-invitation.ts's REMOVE-of-removedAt NOT having cleared the pointer (e.g. a
    // future write path that forgets it) - the worker's own revalidation must still catch it.
    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
    (stored as Record<string, unknown>)["status"] = "ACTIVE";
    delete (stored as Record<string, unknown>)["removedAt"];

    const result = await runMembershipPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedStalePointer).toBe(1);
    const after = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(after?.["GSI8PK"]).toBeUndefined();
    expect(after?.["GSI8SK"]).toBeUndefined();
    expect(after?.["status"]).toBe("ACTIVE"); // untouched otherwise
  });
});
