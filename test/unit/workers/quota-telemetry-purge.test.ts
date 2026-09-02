import { describe, expect, it } from "vitest";
import { runQuotaTelemetryPurge, isPurgeEligibleByWindowEnd, QUOTA_TELEMETRY_RETENTION_DAYS } from "../../../src/workers/quota-telemetry-purge/purge.js";
import { FakeQuotaTelemetryPurgeCandidateSource } from "./quota-telemetry-purge-fakes.js";
import type { QuotaTelemetryPurgeCandidate } from "../../../src/workers/quota-telemetry-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-02T00:00:00.000Z";

function makeCandidate(overrides: Partial<QuotaTelemetryPurgeCandidate> = {}): QuotaTelemetryPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#QUOTA`,
    SK: "TYPE#API_REQUEST#2026-07-01",
    entityType: "TenantQuota",
    tenantId,
    resetAt: "2026-07-01T00:00:00.000Z", // well over 30 days before NOW - eligible by window end
    ...overrides,
  };
}

describe("runQuotaTelemetryPurge (D-154: resetAt+30d physical purge, ACTIVE tenants only / D-179-D-186 MaintenanceDueIndex slice 5)", () => {
  it("purges a TenantQuota record whose window closed more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(0);
    expect(result.quarantinedCount).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("also purges an EphemeralTelemetryMutation row (D-136 D-D: the API_REQUEST lane's entityType, widened into this worker) whose window closed more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const candidate = makeCandidate({ entityType: "EphemeralTelemetryMutation" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never surfaces a record whose window closed less than 30 days ago as a candidate at all (GSI8 is due-ordered)", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const candidate = makeCandidate({ resetAt: "2026-08-20T00:00:00.000Z" }); // ~13 days before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: resetAt+30d == now is eligible, resetAt+30d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - QUOTA_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByWindowEnd(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByWindowEnd(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a record in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job) and increments the retry counter",
    async (status) => {
      const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.tenantId, status);

      const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result).toMatchObject({ scanned: 1, purged: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0, quarantinedCount: 0 });
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
      expect(stored).toBeDefined();
      expect(stored?.["maintenanceAttemptCount"]).toBe(1);
      expect(stored?.["GSI8PK"]).toBe("WORK#QUOTA_TELEMETRY"); // still in WORK namespace, not DLQ yet
    },
  );

  it("never purges a record whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource(); // no setTenantStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a record whose resetAt changed (window rolled forward) between revalidation and claim is never purged", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["resetAt"] = "2026-08-31T00:00:00.000Z";
      return realTransactWrite(entries);
    };

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between revalidation and claim (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realTransactWrite(entries);
    };

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const first = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
  });

  it("processes a mix of eligible/blocked candidates across tenants in one run and touches ONLY the ones GSI8 actually surfaces", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    candidates.setTenantStatus("tenant-active", "ACTIVE");
    candidates.setTenantStatus("tenant-closing", "DELETING");

    const eligible = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#QUOTA", SK: "TYPE#API_REQUEST#2026-07-01" });
    const tooRecent = makeCandidate({
      tenantId: "tenant-active",
      PK: "TENANT#tenant-active#QUOTA",
      SK: "TYPE#UPLOAD_BYTES#2026-08-20",
      resetAt: "2026-08-20T00:00:00.000Z",
    });
    const nonActiveTenant = makeCandidate({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#QUOTA", SK: "TYPE#AI_CALL#2026-07-01" });
    candidates.seed(eligible);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    // tooRecent never appears in GSI8's `GSI8SK < now` query at all - not "scanned and skipped".
    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(1);
    expect(candidates.get({ PK: eligible.PK, SK: eligible.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple GSI8 pages within one run", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    candidates.pageSize = 1;
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#QUOTA", SK: "TYPE#API_REQUEST#2026-07-01" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#QUOTA", SK: "TYPE#UPLOAD_COUNT#2026-07-01" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });

  it("reports the age of the oldest due candidate without extra I/O", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    // resetAt+30d = 2026-07-31T00:00:00.000Z, which is 33 days (2851200s) before NOW (2026-09-02).
    candidates.seed(makeCandidate({ resetAt: "2026-07-01T00:00:00.000Z" }));

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.oldestCandidateAgeSeconds).toBe(33 * 24 * 60 * 60);
  });

  it("reports undefined oldestCandidateAgeSeconds when there is nothing due", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(result.oldestCandidateAgeSeconds).toBeUndefined();
  });

  // D-179 §8 poison-record handling, same as membership-purge/invitation-purge's own test.
  it("quarantines a candidate to the DLQ namespace after MAX_ATTEMPTS failed tenant-ACTIVE revalidations", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "BLOCKED");

    let now = Date.parse(NOW);
    let last;
    for (let i = 0; i < 6; i++) {
      now += 20 * 24 * 60 * 60 * 1000; // 20 days - comfortably past the largest (16d) backoff step
      const nowIso = new Date(now).toISOString();
      last = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => nowIso });
    }

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBe("DLQ#QUOTA_TELEMETRY");
    expect(stored?.["maintenanceAttemptCount"]).toBe(6);
    expect(last!.quarantinedCount).toBe(1);
    const after = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => new Date(now + 1000).toISOString() });
    expect(after.scanned).toBe(0);
  });

  it("cross-tenant isolation: exhausting/quarantining one tenant's candidate never touches another tenant's row", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const blocked = makeCandidate({ tenantId: "tenant-blocked", PK: "TENANT#tenant-blocked#QUOTA" });
    const active = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#QUOTA" });
    candidates.seed(blocked);
    candidates.seed(active);
    candidates.setTenantStatus("tenant-blocked", "BLOCKED");
    candidates.setTenantStatus("tenant-active", "ACTIVE");

    const result = await runQuotaTelemetryPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: blocked.PK, SK: blocked.SK })).toBeDefined();
    expect(candidates.get({ PK: active.PK, SK: active.SK })).toBeUndefined();
  });
});
