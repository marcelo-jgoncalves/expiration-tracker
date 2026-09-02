import { describe, expect, it } from "vitest";
import { runInvitationPurge, isPurgeEligibleByTermination, INVITATION_RETENTION_DAYS } from "../../../src/workers/invitation-purge/purge.js";
import { FakeInvitationPurgeCandidateSource } from "./invitation-purge-fakes.js";
import type { InvitationPurgeCandidate } from "../../../src/workers/invitation-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-02T00:00:00.000Z";

function makeRevoked(overrides: Partial<InvitationPurgeCandidate> = {}): InvitationPurgeCandidate {
  const organizationId = overrides.organizationId ?? "org-1";
  return {
    PK: `TENANT#${organizationId}#ORG#${organizationId}`,
    SK: "INVITATION#inv-1",
    entityType: "Invitation",
    organizationId,
    invitationId: overrides.invitationId ?? "inv-1",
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
    invitationId: overrides.invitationId ?? "inv-2",
    status: "PENDING",
    expiresAt: "2026-07-01T00:00:00.000Z", // well over 30 days before NOW - eligible (never-resolved)
    version: 1,
    ...overrides,
  };
}

describe("runInvitationPurge (D-155: terminal-state+30d physical purge, ACTIVE tenants only / D-179-D-181 MaintenanceDueIndex slice 2)", () => {
  it("purges a REVOKED invitation whose revokedAt is more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(0);
    expect(result.quarantinedCount).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("purges a PENDING invitation whose expiresAt is more than 30 days ago (never resolved, de-facto expired) in an ACTIVE tenant", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makePending();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never surfaces a REVOKED invitation whose revokedAt is less than 30 days ago as a candidate at all (GSI8 is due-ordered)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked({ revokedAt: "2026-08-20T00:00:00.000Z" }); // ~13 days before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never surfaces a PENDING invitation still within its own expiresAt+retention window", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makePending({ expiresAt: "2026-08-31T00:00:00.000Z" }); // still open (1 day before NOW)
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: terminatedAt+30d == now is eligible, terminatedAt+30d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - INVITATION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByTermination({ status: "REVOKED", revokedAt: exactlyAtBoundary, expiresAt: "2026-01-01T00:00:00.000Z" }, NOW)).toBe(true);
    expect(isPurgeEligibleByTermination({ status: "REVOKED", revokedAt: oneMsShort, expiresAt: "2026-01-01T00:00:00.000Z" }, NOW)).toBe(false);
  });

  it("never indexes (and never purges) an ACCEPTED invitation, even seeded directly (defense in depth)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked({ status: "ACCEPTED" as InvitationPurgeCandidate["status"], revokedAt: undefined, SK: "INVITATION#inv-accepted" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never indexes a REVOKED invitation with no revokedAt at all (malformed row, fail-closed defense in depth)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked({ revokedAt: undefined });
    candidates.seed(candidate);

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges an invitation in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job) and increments the retry counter",
    async (status) => {
      const candidates = new FakeInvitationPurgeCandidateSource();
      const candidate = makeRevoked();
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.organizationId, status);

      const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result).toMatchObject({ scanned: 1, purged: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0, quarantinedCount: 0 });
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
      expect(stored).toBeDefined();
      expect(stored?.["maintenanceAttemptCount"]).toBe(1);
      expect(stored?.["GSI8PK"]).toBe("WORK#INVITATION_PURGE"); // still in WORK namespace, not DLQ yet
    },
  );

  it("never purges an invitation whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource(); // no setTenantStatus call - tenant genuinely missing
    const candidate = makeRevoked();
    candidates.seed(candidate);

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: an invitation whose version changed (concurrently modified) between revalidation and claim is never purged", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2;
      return realTransactWrite(entries);
    };

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between revalidation and claim (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realTransactWrite(entries);
    };

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");

    const first = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
  });

  it("processes a mix of eligible/blocked candidates across tenants in one run and touches ONLY the ones GSI8 actually surfaces", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    candidates.setTenantStatus("tenant-active", "ACTIVE");
    candidates.setTenantStatus("tenant-closing", "DELETING");

    const eligible = makeRevoked({ organizationId: "tenant-active", PK: "TENANT#tenant-active#ORG#tenant-active", SK: "INVITATION#inv-a", invitationId: "inv-a" });
    const tooRecent = makeRevoked({
      organizationId: "tenant-active",
      PK: "TENANT#tenant-active#ORG#tenant-active",
      SK: "INVITATION#inv-b",
      invitationId: "inv-b",
      revokedAt: "2026-08-20T00:00:00.000Z",
    });
    const nonActiveTenant = makeRevoked({ organizationId: "tenant-closing", PK: "TENANT#tenant-closing#ORG#tenant-closing", SK: "INVITATION#inv-c", invitationId: "inv-c" });
    candidates.seed(eligible);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    // tooRecent never appears in GSI8's `GSI8SK < now` query at all - not "scanned and skipped".
    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(1);
    expect(candidates.get({ PK: eligible.PK, SK: eligible.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple GSI8 pages within one run", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    candidates.pageSize = 1;
    candidates.setTenantStatus("org-1", "ACTIVE");
    const a = makeRevoked({ SK: "INVITATION#inv-a", invitationId: "inv-a" });
    const b = makePending({ SK: "INVITATION#inv-b", invitationId: "inv-b" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });

  it("reports the age of the oldest due candidate without extra I/O", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    candidates.setTenantStatus("org-1", "ACTIVE");
    // revokedAt+30d = 2026-07-31T00:00:00.000Z, which is 33 days (2851200s) before NOW (2026-09-02).
    candidates.seed(makeRevoked({ revokedAt: "2026-07-01T00:00:00.000Z" }));

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.oldestCandidateAgeSeconds).toBe(33 * 24 * 60 * 60);
  });

  it("reports undefined oldestCandidateAgeSeconds when there is nothing due", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(result.oldestCandidateAgeSeconds).toBeUndefined();
  });

  // D-179 §8 poison-record handling, same as membership-purge's own test.
  it("quarantines a candidate to the DLQ namespace after MAX_ATTEMPTS failed tenant-ACTIVE revalidations", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "BLOCKED");

    let now = Date.parse(NOW);
    let last;
    for (let i = 0; i < 6; i++) {
      now += 20 * 24 * 60 * 60 * 1000; // 20 days - comfortably past the largest (16d) backoff step
      const nowIso = new Date(now).toISOString();
      last = await runInvitationPurge({ candidates, tableName: TABLE, now: () => nowIso });
    }

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBe("DLQ#INVITATION_PURGE");
    expect(stored?.["maintenanceAttemptCount"]).toBe(6);
    expect(last!.quarantinedCount).toBe(1);
    const after = await runInvitationPurge({ candidates, tableName: TABLE, now: () => new Date(now + 1000).toISOString() });
    expect(after.scanned).toBe(0);
  });

  // D-179 §4/§7 self-heal, defensive: no real write path produces a stale INVITATION_PURGE
  // pointer today (see purge.ts's file header - REVOKED/ACCEPTED are both terminal, ACCEPTED
  // clears its own pointer atomically), but the worker must still self-heal one if it ever found
  // it, exactly like membership-purge does for a reactivated Membership.
  it("self-heals a stale GSI8 pointer left on an invitation that is no longer a real candidate (defensive - no live path produces this today)", async () => {
    const candidates = new FakeInvitationPurgeCandidateSource();
    const candidate = makeRevoked({ invitationId: "inv-stale" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.organizationId, "ACTIVE");
    // Simulate a hypothetical future write path that forgot to clear the pointer on ACCEPTED.
    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
    (stored as Record<string, unknown>)["status"] = "ACCEPTED";
    delete (stored as Record<string, unknown>)["revokedAt"];

    const result = await runInvitationPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedStalePointer).toBe(1);
    const after = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(after?.["GSI8PK"]).toBeUndefined();
    expect(after?.["GSI8SK"]).toBeUndefined();
    expect(after?.["status"]).toBe("ACCEPTED"); // untouched otherwise
  });
});
