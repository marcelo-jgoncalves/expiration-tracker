import { describe, expect, it } from "vitest";
import { runQuotaTelemetryPurge, isPurgeEligibleByWindowEnd, QUOTA_TELEMETRY_RETENTION_DAYS } from "../../../src/workers/quota-telemetry-purge/purge.js";
import { FakeQuotaTelemetryPurgeCandidateSource, FakeTenantLifecycleStatusSource } from "./quota-telemetry-purge-fakes.js";
import type { QuotaTelemetryPurgeCandidate } from "../../../src/workers/quota-telemetry-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-01T00:00:00.000Z";

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

describe("runQuotaTelemetryPurge (D-154: resetAt+30d physical purge, ACTIVE tenants only)", () => {
  it("purges a TenantQuota record whose window closed more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never purges a record whose window closed less than 30 days ago, even in an ACTIVE tenant", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({ resetAt: "2026-08-20T00:00:00.000Z" }); // ~12 days before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: resetAt+30d == now is eligible, resetAt+30d-1ms is not", async () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - QUOTA_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByWindowEnd(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByWindowEnd(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a record in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job)",
    async (status) => {
      const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
      const lifecycle = new FakeTenantLifecycleStatusSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      lifecycle.setStatus(candidate.tenantId, status);

      const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

      expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    },
  );

  it("also purges an EphemeralTelemetryMutation row (D-136 D-D: the API_REQUEST lane's entityType, widened into this worker's scan alongside TenantQuota) whose window closed more than 30 days ago in an ACTIVE tenant", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({ entityType: "EphemeralTelemetryMutation" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never purges a record whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource(); // no setStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a record whose resetAt changed (window rolled forward) between scan and delete is never purged", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    // Simulate a concurrent consume()/release() racing this worker: resetAt rolls forward on the
    // underlying row AFTER the scan already produced `candidate`, but BEFORE this worker's delete
    // call fires - wired into deleteCandidate itself, exactly where the real race window is.
    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["resetAt"] = "2026-08-31T00:00:00.000Z";
      return realDelete(input);
    };

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 1 });
    // The record is untouched, not silently deleted despite the race.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between scan and delete (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      // Simulate the row already being gone by the time this worker's delete fires (e.g. a
      // second concurrent run of this same worker won the race first).
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realDelete(input);
    };

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const first = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second).toEqual({ scanned: 0, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes a mix of eligible/ineligible candidates across tenants in one run and touches ONLY the eligible ones", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-active", "ACTIVE");
    lifecycle.setStatus("tenant-closing", "DELETING");

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

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 3, purged: 1, skippedTooRecent: 1, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: eligible.PK, SK: eligible.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple scan pages within one run", async () => {
    const candidates = new FakeQuotaTelemetryPurgeCandidateSource();
    candidates.pageSize = 1;
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#QUOTA", SK: "TYPE#API_REQUEST#2026-07-01" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#QUOTA", SK: "TYPE#UPLOAD_COUNT#2026-07-01" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runQuotaTelemetryPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });
});
