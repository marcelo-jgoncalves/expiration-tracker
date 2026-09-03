import { describe, expect, it } from "vitest";
import { runDeliveryRecordPurge, isPurgeEligibleByAge, DELIVERY_RECORD_RETENTION_DAYS } from "../../../src/workers/delivery-record-purge/purge.js";
import { FakeDeliveryRecordPurgeCandidateSource } from "./delivery-record-purge-fakes.js";
import type { DeliveryRecordPurgeCandidate } from "../../../src/workers/delivery-record-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-02T00:00:00.000Z";

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

describe("runDeliveryRecordPurge (D-152: createdAt+180d physical purge, ACTIVE tenants only / D-179 MaintenanceDueIndex slice 8)", () => {
  it.each(["NotificationIntent", "NotificationAttempt"] as const)(
    "purges a %s row whose createdAt is more than 180 days old in an ACTIVE tenant",
    async (entityType) => {
      const candidates = new FakeDeliveryRecordPurgeCandidateSource();
      const candidate = makeCandidate({ entityType, SK: entityType === "NotificationAttempt" ? "ATTEMPT#000001#a1" : "META" });
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

      const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result.scanned).toBe(1);
      expect(result.purged).toBe(1);
      expect(result.skippedTenantNotActive).toBe(0);
      expect(result.skippedConcurrentlyModified).toBe(0);
      expect(result.quarantinedCount).toBe(0);
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
    },
  );

  it("never surfaces a record created less than 180 days ago as a candidate at all (GSI8 is due-ordered)", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const candidate = makeCandidate({ createdAt: "2026-08-20T00:00:00.000Z" }); // ~13 days before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("purges a record regardless of its delivery status, once old enough (no deletedAt-like fence exists for this class)", async () => {
    // DELIVERY_RECORD's whole point: unlike CORE_USER_DATA, eligibility here is age-only - a
    // still-PENDING/never-cancelled intent purges just the same once it crosses the retention
    // window, because a fixed compliance window applies regardless of outcome.
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const candidate = { ...makeCandidate(), status: "PENDING" };
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("is exactly boundary-inclusive: createdAt+180d == now is eligible, createdAt+180d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - DELIVERY_RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByAge(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByAge(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a record in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job) and increments the retry counter",
    async (status) => {
      const candidates = new FakeDeliveryRecordPurgeCandidateSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.tenantId, status);

      const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result).toMatchObject({ scanned: 1, purged: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0, quarantinedCount: 0 });
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
      expect(stored).toBeDefined();
      expect(stored?.["maintenanceAttemptCount"]).toBe(1);
      expect(stored?.["GSI8PK"]).toBe("WORK#DELIVERY_RECORD"); // still in WORK namespace, not DLQ yet
    },
  );

  it("never purges a record whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource(); // no setTenantStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a record whose createdAt changed between revalidation and claim is never purged", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["createdAt"] = "2026-08-31T00:00:00.000Z";
      return realTransactWrite(entries);
    };

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a concurrent OCC version bump between revalidation and claim is never silently overwritten", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2; // concurrent write bumped version after revalidation read v1
      return realTransactWrite(entries);
    };

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a record deleted between revalidation and claim (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realTransactWrite(entries);
    };

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const first = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
  });

  it("processes a mix of eligible/blocked candidates across tenants/entity types in one run and touches ONLY the ones GSI8 actually surfaces", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    candidates.setTenantStatus("tenant-active", "ACTIVE");
    candidates.setTenantStatus("tenant-closing", "DELETING");

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

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    // tooRecent never appears in GSI8's `GSI8SK < now` query at all - not "scanned and skipped".
    expect(result.scanned).toBe(3);
    expect(result.purged).toBe(2);
    expect(result.skippedTenantNotActive).toBe(1);
    expect(candidates.get({ PK: eligibleIntent.PK, SK: eligibleIntent.SK })).toBeUndefined();
    expect(candidates.get({ PK: eligibleAttempt.PK, SK: eligibleAttempt.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple GSI8 pages within one run", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    candidates.pageSize = 1;
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#INTENT#a", SK: "META" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#INTENT#b", SK: "META" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });

  it("reports the age of the oldest due candidate without extra I/O", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    // createdAt+180d = 2026-06-30T00:00:00.000Z, which is 64 days (5529600s) before NOW (2026-09-02).
    candidates.seed(makeCandidate({ createdAt: "2026-01-01T00:00:00.000Z" }));

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.oldestCandidateAgeSeconds).toBe(64 * 24 * 60 * 60);
  });

  it("reports undefined oldestCandidateAgeSeconds when there is nothing due", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(result.oldestCandidateAgeSeconds).toBeUndefined();
  });

  // D-179 §8 poison-record handling, same as security-audit-purge/quota-telemetry-purge.
  it("quarantines a candidate to the DLQ namespace after MAX_ATTEMPTS failed tenant-ACTIVE revalidations", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "BLOCKED");

    let now = Date.parse(NOW);
    let last;
    for (let i = 0; i < 6; i++) {
      now += 20 * 24 * 60 * 60 * 1000; // 20 days - comfortably past the largest (16d) backoff step
      const nowIso = new Date(now).toISOString();
      last = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => nowIso });
    }

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBe("DLQ#DELIVERY_RECORD");
    expect(stored?.["maintenanceAttemptCount"]).toBe(6);
    expect(last!.quarantinedCount).toBe(1);
    const after = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => new Date(now + 1000).toISOString() });
    expect(after.scanned).toBe(0);
  });

  it("cross-tenant isolation: exhausting/quarantining one tenant's candidate never touches another tenant's row", async () => {
    const candidates = new FakeDeliveryRecordPurgeCandidateSource();
    const blocked = makeCandidate({ tenantId: "tenant-blocked", PK: "TENANT#tenant-blocked#INTENT#i1" });
    const active = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#INTENT#i1" });
    candidates.seed(blocked);
    candidates.seed(active);
    candidates.setTenantStatus("tenant-blocked", "BLOCKED");
    candidates.setTenantStatus("tenant-active", "ACTIVE");

    const result = await runDeliveryRecordPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: blocked.PK, SK: blocked.SK })).toBeDefined();
    expect(candidates.get({ PK: active.PK, SK: active.SK })).toBeUndefined();
  });
});
