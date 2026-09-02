import { describe, expect, it } from "vitest";
import { runSecurityAuditPurge, isPurgeEligibleByAge, SECURITY_AUDIT_RETENTION_DAYS } from "../../../src/workers/security-audit-purge/purge.js";
import { FakeSecurityAuditPurgeCandidateSource } from "./security-audit-purge-fakes.js";
import type { SecurityAuditPurgeCandidate } from "../../../src/workers/security-audit-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-02T00:00:00.000Z";

function makeCandidate(overrides: Partial<SecurityAuditPurgeCandidate> = {}): SecurityAuditPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#AUDIT#202507`,
    SK: "EVT#2025-07-01T00:00:00.000Z#evt-1",
    entityType: "AuditEvent",
    tenantId,
    occurredAt: "2025-07-01T00:00:00.000Z", // well over 365 days before NOW - eligible by age
    ...overrides,
  };
}

describe("runSecurityAuditPurge (D-153: occurredAt+365d physical purge, ACTIVE tenants only / D-179/D-187 MaintenanceDueIndex slice 6)", () => {
  it.each(["AuditEvent", "MembershipAuditEvent", "SubjectAuditEvent", "TenantAuditEvent"] as const)(
    "purges a %s row whose occurredAt is more than 365 days old in an ACTIVE tenant",
    async (entityType) => {
      const candidates = new FakeSecurityAuditPurgeCandidateSource();
      const candidate = makeCandidate({ entityType });
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

      const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result.scanned).toBe(1);
      expect(result.purged).toBe(1);
      expect(result.skippedTenantNotActive).toBe(0);
      expect(result.skippedConcurrentlyModified).toBe(0);
      expect(result.quarantinedCount).toBe(0);
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
    },
  );

  it("never surfaces a row younger than 365 days as a candidate at all (GSI8 is due-ordered)", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const candidate = makeCandidate({ occurredAt: "2026-08-20T00:00:00.000Z" }); // ~13 days before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: occurredAt+365d == now is eligible, occurredAt+365d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - SECURITY_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByAge(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByAge(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a row in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job) and increments the retry counter",
    async (status) => {
      const candidates = new FakeSecurityAuditPurgeCandidateSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.tenantId, status);

      const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result).toMatchObject({ scanned: 1, purged: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0, quarantinedCount: 0 });
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
      expect(stored).toBeDefined();
      expect(stored?.["maintenanceAttemptCount"]).toBe(1);
      expect(stored?.["GSI8PK"]).toBe("WORK#SECURITY_AUDIT"); // still in WORK namespace, not DLQ yet
    },
  );

  it("never purges a row whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource(); // no setTenantStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("MembershipAuditEvent normalization: organizationId is treated exactly as tenantId for the ACTIVE fence", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const candidate = makeCandidate({ entityType: "MembershipAuditEvent", tenantId: "org-1", PK: "TENANT#org-1#MEMBERSHIPAUDIT#202507" });
    candidates.seed(candidate);
    candidates.setTenantStatus("org-1", "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("conditional-delete guard: a row whose occurredAt changed between revalidation and claim is never purged", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["occurredAt"] = "2025-08-01T00:00:00.000Z";
      return realTransactWrite(entries);
    };

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between revalidation and claim (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realTransactWrite(entries);
    };

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const first = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
  });

  it("processes a mix of eligible/blocked candidates across tenants in one run and touches ONLY the ones GSI8 actually surfaces", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    candidates.setTenantStatus("tenant-active", "ACTIVE");
    candidates.setTenantStatus("tenant-closing", "DELETING");

    const eligible = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#AUDIT#202507", SK: "EVT#2025-07-01T00:00:00.000Z#evt-a" });
    const tooRecent = makeCandidate({
      tenantId: "tenant-active",
      PK: "TENANT#tenant-active#AUDIT#202508",
      SK: "EVT#2026-08-20T00:00:00.000Z#evt-b",
      occurredAt: "2026-08-20T00:00:00.000Z",
    });
    const nonActiveTenant = makeCandidate({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#AUDIT#202507", SK: "EVT#2025-07-01T00:00:00.000Z#evt-c" });
    candidates.seed(eligible);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    // tooRecent never appears in GSI8's `GSI8SK < now` query at all - not "scanned and skipped".
    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(1);
    expect(candidates.get({ PK: eligible.PK, SK: eligible.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple GSI8 pages within one run", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    candidates.pageSize = 1;
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#AUDIT#202507", SK: "EVT#2025-07-01T00:00:00.000Z#evt-a" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#AUDIT#202507", SK: "EVT#2025-07-01T00:00:00.000Z#evt-b" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });

  it("reports the age of the oldest due candidate without extra I/O", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    // occurredAt+365d = 2026-07-01T00:00:00.000Z, which is 63 days (5443200s) before NOW (2026-09-02).
    candidates.seed(makeCandidate({ occurredAt: "2025-07-01T00:00:00.000Z" }));

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.oldestCandidateAgeSeconds).toBe(63 * 24 * 60 * 60);
  });

  it("reports undefined oldestCandidateAgeSeconds when there is nothing due", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(result.oldestCandidateAgeSeconds).toBeUndefined();
  });

  // D-179 §8 poison-record handling, same as membership-purge/invitation-purge/quota-telemetry-purge.
  it("quarantines a candidate to the DLQ namespace after MAX_ATTEMPTS failed tenant-ACTIVE revalidations", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "BLOCKED");

    let now = Date.parse(NOW);
    let last;
    for (let i = 0; i < 6; i++) {
      now += 20 * 24 * 60 * 60 * 1000; // 20 days - comfortably past the largest (16d) backoff step
      const nowIso = new Date(now).toISOString();
      last = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => nowIso });
    }

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBe("DLQ#SECURITY_AUDIT");
    expect(stored?.["maintenanceAttemptCount"]).toBe(6);
    expect(last!.quarantinedCount).toBe(1);
    const after = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => new Date(now + 1000).toISOString() });
    expect(after.scanned).toBe(0);
  });

  it("cross-tenant isolation: exhausting/quarantining one tenant's candidate never touches another tenant's row", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const blocked = makeCandidate({ tenantId: "tenant-blocked", PK: "TENANT#tenant-blocked#AUDIT#202507" });
    const active = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#AUDIT#202507" });
    candidates.seed(blocked);
    candidates.seed(active);
    candidates.setTenantStatus("tenant-blocked", "BLOCKED");
    candidates.setTenantStatus("tenant-active", "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: blocked.PK, SK: blocked.SK })).toBeDefined();
    expect(candidates.get({ PK: active.PK, SK: active.SK })).toBeUndefined();
  });
});
