import { describe, expect, it } from "vitest";
import { runDeliveryRecordPurge, isPurgeEligibleByAge, DELIVERY_RECORD_RETENTION_DAYS } from "../../../src/workers/delivery-record-purge/purge.js";
import { FakeDeliveryRecordPurgeCandidateSource, FakeTenantLifecycleStatusSource } from "./delivery-record-purge-fakes.js";
import type { DeliveryRecordPurgeCandidate } from "../../../src/workers/delivery-record-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-01T00:00:00.000Z";

function makeCandidate(overrides: Partial<DeliveryRecordPurgeCandidate> = {}): DeliveryRecordPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  const intentId = "intent-1";
  return {
    PK: `TENANT#${tenantId}#INTENT#${intentId}`,
    SK: "META",
    entityType: "NotificationIntent",
    tenantId,
    createdAt: "2026-01-01T00:00:00.000Z", // well over 180 days before NOW - eligible by age
    version: 1,
    ...overrides,
  };
}

describe("runDeliveryRecordPurge (D-152: createdAt+180d physical purge, ACTIVE tenants only)", () => {
  it("purges a NotificationIntent created more than 180 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("purges a NotificationAttempt created more than 180 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({ entityType: "NotificationAttempt", PK: "TENANT#tenant-1#INTENT#intent-1", SK: "ATTEMPT#000001#a1" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("never purges a record created less than 180 days ago, even in an ACTIVE tenant", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({ createdAt: "2026-06-01T00:00:00.000Z" }); // ~92 days before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("purges a record regardless of its delivery status, once old enough (no deletedAt-like fence exists for this class)", async () => {
    // DELIVERY_RECORD's whole point (task brief): unlike CORE_USER_DATA, eligibility here is
    // age-only - a still-PENDING/never-cancelled intent purges just the same once it crosses
    // the retention window, because a fixed compliance window applies regardless of outcome.
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = { ...makeCandidate(), status: "PENDING" };
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("is exactly boundary-inclusive: createdAt+180d == now is eligible, createdAt+180d-1ms is not", async () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - DELIVERY_RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByAge(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByAge(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a record in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job)",
    async (status) => {
      const candidates = new FakeDeliveryRecordPurgeCandidateSource();
      const lifecycle = new FakeTenantLifecycleStatusSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      lifecycle.setStatus(candidate.tenantId, status);

      const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

      expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    },
  );

  it("never purges a record whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource(); // no setStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a record whose createdAt changed between scan and delete is never purged", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    // Simulate a concurrent write racing this worker: createdAt changes on the underlying row
    // AFTER the scan already produced `candidate`, but BEFORE this worker's delete call fires -
    // wired into deleteCandidate itself, exactly where the real race window is (mutating before
    // invoking the worker would just change what the scan itself observes).
    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["createdAt"] = "2026-08-31T00:00:00.000Z";
      return realDelete(input);
    };

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 1 });
    // The record is untouched, not silently deleted despite the race.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a version bump (any other concurrent write) between scan and delete is never silently overwritten", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2; // concurrent write bumped version after the scan read v1
      return realDelete(input);
    };

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const first = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second).toEqual({ scanned: 0, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes a mix of eligible/ineligible candidates across tenants/entity types in one run and touches ONLY the eligible ones", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-active", "ACTIVE");
    lifecycle.setStatus("tenant-closing", "DELETING");

    const eligibleIntent = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#INTENT#i1", SK: "META" });
    const eligibleAttempt = makeCandidate({
      tenantId: "tenant-active",
      entityType: "NotificationAttempt",
      PK: "TENANT#tenant-active#INTENT#i1",
      SK: "ATTEMPT#000001#a1",
    });
    const tooRecent = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#INTENT#i2", SK: "META", createdAt: "2026-08-20T00:00:00.000Z" });
    const nonActiveTenant = makeCandidate({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#INTENT#i3", SK: "META" });
    candidates.seed(eligibleIntent);
    candidates.seed(eligibleAttempt);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 4, purged: 2, skippedTooRecent: 1, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: eligibleIntent.PK, SK: eligibleIntent.SK })).toBeUndefined();
    expect(candidates.get({ PK: eligibleAttempt.PK, SK: eligibleAttempt.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple scan pages within one run", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    candidates.pageSize = 1;
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#INTENT#a", SK: "META" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#INTENT#b", SK: "META" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runDeliveryRecordPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });
});
