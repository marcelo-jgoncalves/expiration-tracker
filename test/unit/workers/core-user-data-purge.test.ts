import { describe, expect, it } from "vitest";
import { runCoreUserDataPurge, isPurgeEligibleByAge, CORE_USER_DATA_RETENTION_DAYS } from "../../../src/workers/core-user-data-purge/purge.js";
import { FakeCoreUserDataPurgeCandidateSource, FakeTenantLifecycleStatusSource } from "./core-user-data-purge-fakes.js";
import type { CoreUserDataPurgeCandidate } from "../../../src/workers/core-user-data-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-01T00:00:00.000Z";

function makeCandidate(overrides: Partial<CoreUserDataPurgeCandidate> = {}): CoreUserDataPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  const id = "item-1";
  return {
    PK: `TENANT#${tenantId}#ITEM#${id}`,
    SK: "META",
    entityType: "ExpirationItem",
    tenantId,
    deletedAt: "2026-07-30T00:00:00.000Z", // 33 days before NOW - eligible by age
    version: 1,
    ...overrides,
  };
}

describe("runCoreUserDataPurge (D-151: deletedAt+30d physical purge, ACTIVE tenants only)", () => {
  it("purges an ExpirationItem deleted more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("purges a ReminderPolicy deleted more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({ entityType: "ReminderPolicy", PK: "TENANT#tenant-1#POLICY#p1", SK: "META" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("never purges a record deleted less than 30 days ago, even in an ACTIVE tenant", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({ deletedAt: "2026-08-15T00:00:00.000Z" }); // 17 days before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: deletedAt+30d == now is eligible, deletedAt+30d-1ms is not", async () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - CORE_USER_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByAge(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByAge(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a record in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job)",
    async (status) => {
      const candidates = new FakeCoreUserDataPurgeCandidateSource();
      const lifecycle = new FakeTenantLifecycleStatusSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      lifecycle.setStatus(candidate.tenantId, status);

      const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

      expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    },
  );

  it("never purges a record whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource(); // no setStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a record whose deletedAt changed (undelete/restore) between scan and delete is never purged", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    // Simulate a restore racing this worker: deletedAt is cleared on the underlying row AFTER
    // the scan already produced `candidate`, but BEFORE this worker's delete call fires -
    // the exact race the task brief calls out as the single most important property to prove.
    // Mutating the store BEFORE invoking the worker would also hide the row from the scan
    // itself (attribute_exists(deletedAt) would no longer match) - the mutation must land
    // between scan and delete, so it is wired into deleteCandidate itself, exactly where the
    // real race window is.
    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      delete (stored as Record<string, unknown>)["deletedAt"];
      return realDelete(input);
    };

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 1 });
    // The record is untouched, not silently deleted despite the race.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a version bump (any other concurrent write) between scan and delete is never silently overwritten", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    // Same "mutate between scan and delete" shape as the deletedAt race above.
    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2; // concurrent write bumped version after the scan read v1
      return realDelete(input);
    };

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const first = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second).toEqual({ scanned: 0, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes a mix of eligible/ineligible candidates across tenants/entity types in one run and touches ONLY the eligible ones", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-active", "ACTIVE");
    lifecycle.setStatus("tenant-closing", "DELETING");

    const eligibleItem = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#ITEM#i1", SK: "META" });
    const eligiblePolicy = makeCandidate({ tenantId: "tenant-active", entityType: "ReminderPolicy", PK: "TENANT#tenant-active#POLICY#p1", SK: "META" });
    const tooRecent = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#ITEM#i2", SK: "META", deletedAt: "2026-08-20T00:00:00.000Z" });
    const nonActiveTenant = makeCandidate({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#ITEM#i3", SK: "META" });
    candidates.seed(eligibleItem);
    candidates.seed(eligiblePolicy);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 4, purged: 2, skippedTooRecent: 1, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: eligibleItem.PK, SK: eligibleItem.SK })).toBeUndefined();
    expect(candidates.get({ PK: eligiblePolicy.PK, SK: eligiblePolicy.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple scan pages within one run", async () => {
    const candidates = new FakeCoreUserDataPurgeCandidateSource();
    candidates.pageSize = 1;
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#ITEM#a", SK: "META" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#ITEM#b", SK: "META" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runCoreUserDataPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });
});
