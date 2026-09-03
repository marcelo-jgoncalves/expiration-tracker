import { describe, expect, it } from "vitest";
import { runCoreUserDataPurge, isPurgeEligibleByAge, CORE_USER_DATA_RETENTION_DAYS } from "../../../src/workers/core-user-data-purge/purge.js";
import { FakeCoreUserDataPurgeCandidateSource } from "./core-user-data-purge-fakes.js";
import type { CoreUserDataPurgeCandidate } from "../../../src/workers/core-user-data-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-02T00:00:00.000Z";

function makeCandidate(overrides: Partial<CoreUserDataPurgeCandidate> = {}): CoreUserDataPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  const id = "item-1";
  return {
    PK: `TENANT#${tenantId}#ITEM#${id}`,
    SK: "META",
    entityType: "ExpirationItem",
    tenantId,
    deletedAt: "2026-07-30T00:00:00.000Z", // 34 days before NOW - eligible by age
    version: 1,
    ...overrides,
  };
}

describe("runCoreUserDataPurge (D-151: deletedAt+30d physical purge, ACTIVE tenants only / D-179 MaintenanceDueIndex slice 9 — 9th and LAST)", () => {
  it.each(["ExpirationItem", "ReminderPolicy"] as const)("purges a %s row deleted more than 30 days ago in an ACTIVE tenant", async (entityType) => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate(
      entityType === "ReminderPolicy" ? { entityType, PK: "TENANT#tenant-1#POLICY#p1" } : { entityType },
    );
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(0);
    expect(result.quarantinedCount).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never surfaces a record deleted less than 30 days ago as a candidate at all (GSI8 is due-ordered)", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate({ deletedAt: "2026-08-20T00:00:00.000Z" }); // ~13 days before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("never surfaces a row that has never been soft-deleted at all (no deletedAt, no pointer, no candidate)", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate();
    delete (candidate as Partial<CoreUserDataPurgeCandidate>).deletedAt;
    candidates.seed(candidate as CoreUserDataPurgeCandidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: deletedAt+30d == now is eligible, deletedAt+30d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - CORE_USER_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByAge(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByAge(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a record in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job) and increments the retry counter",
    async (status) => {
      const candidates = new FakeCoreUserDataPurgeCandidateSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.tenantId, status);

      const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result).toMatchObject({ scanned: 1, purged: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0, quarantinedCount: 0 });
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
      expect(stored).toBeDefined();
      expect(stored?.["maintenanceAttemptCount"]).toBe(1);
      expect(stored?.["GSI8PK"]).toBe("WORK#CORE_USER_DATA"); // still in WORK namespace, not DLQ yet
    },
  );

  it("never purges a record whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource(); // no setTenantStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a record whose deletedAt changed (undelete/restore) between revalidation and claim is never purged", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    // The single most important correctness property here (task brief): simulate a restore
    // racing this worker between revalidation (getCandidate) and the claim transaction.
    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      delete (stored as Record<string, unknown>)["deletedAt"];
      return realTransactWrite(entries);
    };

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a concurrent OCC version bump between revalidation and claim is never silently overwritten", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2; // concurrent write bumped version after revalidation read v1
      return realTransactWrite(entries);
    };

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a record deleted between revalidation and claim (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realTransactWrite(entries);
    };

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const first = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
  });

  it("processes a mix of eligible/blocked candidates across tenants/entity types in one run and touches ONLY the ones GSI8 actually surfaces", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    candidates.setTenantStatus("tenant-active", "ACTIVE");
    candidates.setTenantStatus("tenant-closing", "DELETING");

    const eligibleItem = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#ITEM#i1", SK: "META" });
    const eligiblePolicy = makeCandidate({ tenantId: "tenant-active", entityType: "ReminderPolicy", PK: "TENANT#tenant-active#POLICY#p1", SK: "META" });
    const tooRecent = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#ITEM#i2", SK: "META", deletedAt: "2026-08-20T00:00:00.000Z" });
    const nonActiveTenant = makeCandidate({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#ITEM#i3", SK: "META" });
    candidates.seed(eligibleItem);
    candidates.seed(eligiblePolicy);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    // tooRecent never appears in GSI8's `GSI8SK < now` query at all - not "scanned and skipped".
    expect(result.scanned).toBe(3);
    expect(result.purged).toBe(2);
    expect(result.skippedTenantNotActive).toBe(1);
    expect(candidates.get({ PK: eligibleItem.PK, SK: eligibleItem.SK })).toBeUndefined();
    expect(candidates.get({ PK: eligiblePolicy.PK, SK: eligiblePolicy.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple GSI8 pages within one run", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    candidates.pageSize = 1;
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#ITEM#a", SK: "META" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#ITEM#b", SK: "META" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });

  it("reports the age of the oldest due candidate without extra I/O", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    // deletedAt+30d = 2026-08-29T00:00:00.000Z, which is 4 days (345600s) before NOW (2026-09-02).
    candidates.seed(makeCandidate({ deletedAt: "2026-07-30T00:00:00.000Z" }));

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.oldestCandidateAgeSeconds).toBe(4 * 24 * 60 * 60);
  });

  it("reports undefined oldestCandidateAgeSeconds when there is nothing due", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(result.oldestCandidateAgeSeconds).toBeUndefined();
  });

  // D-179 §8 poison-record handling, same as delivery-record-purge/security-audit-purge.
  it("quarantines a candidate to the DLQ namespace after MAX_ATTEMPTS failed tenant-ACTIVE revalidations", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "BLOCKED");

    let now = Date.parse(NOW);
    let last;
    for (let i = 0; i < 6; i++) {
      now += 20 * 24 * 60 * 60 * 1000; // 20 days - comfortably past the largest (16d) backoff step
      const nowIso = new Date(now).toISOString();
      last = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => nowIso });
    }

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBe("DLQ#CORE_USER_DATA");
    expect(stored?.["maintenanceAttemptCount"]).toBe(6);
    expect(last!.quarantinedCount).toBe(1);
    const after = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => new Date(now + 1000).toISOString() });
    expect(after.scanned).toBe(0);
  });

  it("cross-tenant isolation: exhausting/quarantining one tenant's candidate never touches another tenant's row", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const blocked = makeCandidate({ tenantId: "tenant-blocked", PK: "TENANT#tenant-blocked#ITEM#i1" });
    const active = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#ITEM#i1" });
    candidates.seed(blocked);
    candidates.seed(active);
    candidates.setTenantStatus("tenant-blocked", "BLOCKED");
    candidates.setTenantStatus("tenant-active", "ACTIVE");

    const result = await runCoreUserDataPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: blocked.PK, SK: blocked.SK })).toBeDefined();
    expect(candidates.get({ PK: active.PK, SK: active.SK })).toBeUndefined();
  });
});
