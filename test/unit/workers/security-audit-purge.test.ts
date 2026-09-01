import { describe, expect, it } from "vitest";
import { runSecurityAuditPurge, isPurgeEligibleByAge, SECURITY_AUDIT_RETENTION_DAYS } from "../../../src/workers/security-audit-purge/purge.js";
import { FakeSecurityAuditPurgeCandidateSource, FakeTenantLifecycleStatusSource } from "./security-audit-purge-fakes.js";
import type { SecurityAuditPurgeCandidate } from "../../../src/workers/security-audit-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-01T00:00:00.000Z";

function makeCandidate(overrides: Partial<SecurityAuditPurgeCandidate> = {}): SecurityAuditPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  const auditId = "audit-1";
  return {
    PK: `TENANT#${tenantId}#AUDIT#202601`,
    SK: `EVT#2026-01-01T00:00:00.000Z#${auditId}`,
    entityType: "AuditEvent",
    tenantId,
    occurredAt: "2025-01-01T00:00:00.000Z", // well over 365 days before NOW - eligible by age
    ...overrides,
  };
}

describe("runSecurityAuditPurge (D-153: occurredAt+365d physical purge, ACTIVE tenants only)", () => {
  it("purges an AuditEvent (expiration module) older than 365 days in an ACTIVE tenant", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("purges a MembershipAuditEvent (organization module) — normalized via organizationId, not tenantId", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({
      entityType: "MembershipAuditEvent",
      PK: "TENANT#tenant-1#MEMBERSHIPAUDIT#202601",
      SK: "EVT#2026-01-01T00:00:00.000Z#m1",
    });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("purges a SubjectAuditEvent (subject module) older than 365 days in an ACTIVE tenant", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({
      entityType: "SubjectAuditEvent",
      PK: "TENANT#tenant-1#SUBJECTAUDIT#202601",
      SK: "EVT#2026-01-01T00:00:00.000Z#s1",
    });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("purges a TenantAuditEvent (activity module, D-149 export-audit gap) older than 365 days in an ACTIVE tenant", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({
      entityType: "TenantAuditEvent",
      PK: "TENANT#tenant-1#TENANTAUDIT#202601",
      SK: "EVT#2026-01-01T00:00:00.000Z#t1",
    });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
  });

  it("never purges a record whose occurredAt is less than 365 days old, even in an ACTIVE tenant", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate({ occurredAt: "2026-06-01T00:00:00.000Z" }); // ~92 days before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is exactly boundary-inclusive: occurredAt+365d == now is eligible, occurredAt+365d-1ms is not", async () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - SECURITY_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isPurgeEligibleByAge(exactlyAtBoundary, NOW)).toBe(true);
    expect(isPurgeEligibleByAge(oneMsShort, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a record in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job)",
    async (status) => {
      const candidates = new FakeSecurityAuditPurgeCandidateSource();
      const lifecycle = new FakeTenantLifecycleStatusSource();
      const candidate = makeCandidate();
      candidates.seed(candidate);
      lifecycle.setStatus(candidate.tenantId, status);

      const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

      expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    },
  );

  it("never purges a record whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource(); // no setStatus call - tenant genuinely missing
    const candidate = makeCandidate();
    candidates.seed(candidate);

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a record whose occurredAt changed between scan and delete is never purged", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    // Simulate a concurrent write racing this worker: occurredAt changes on the underlying row
    // AFTER the scan already produced `candidate`, but BEFORE this worker's delete call fires -
    // wired into deleteCandidate itself, exactly where the real race window is.
    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["occurredAt"] = "2026-08-31T00:00:00.000Z";
      return realDelete(input);
    };

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 1 });
    // The record is untouched, not silently deleted despite the race.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between scan and delete (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
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

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeCandidate();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const first = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second).toEqual({ scanned: 0, purged: 0, skippedTooRecent: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes a mix of eligible/ineligible candidates across all 4 entity types/tenants in one run and touches ONLY the eligible ones", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-active", "ACTIVE");
    lifecycle.setStatus("tenant-closing", "DELETING");

    const eligibleAudit = makeCandidate({ tenantId: "tenant-active", PK: "TENANT#tenant-active#AUDIT#202601", SK: "EVT#2026-01-01T00:00:00.000Z#a1" });
    const eligibleMembership = makeCandidate({
      tenantId: "tenant-active",
      entityType: "MembershipAuditEvent",
      PK: "TENANT#tenant-active#MEMBERSHIPAUDIT#202601",
      SK: "EVT#2026-01-01T00:00:00.000Z#m1",
    });
    const eligibleSubject = makeCandidate({
      tenantId: "tenant-active",
      entityType: "SubjectAuditEvent",
      PK: "TENANT#tenant-active#SUBJECTAUDIT#202601",
      SK: "EVT#2026-01-01T00:00:00.000Z#s1",
    });
    const eligibleTenant = makeCandidate({
      tenantId: "tenant-active",
      entityType: "TenantAuditEvent",
      PK: "TENANT#tenant-active#TENANTAUDIT#202601",
      SK: "EVT#2026-01-01T00:00:00.000Z#t1",
    });
    const tooRecent = makeCandidate({
      tenantId: "tenant-active",
      PK: "TENANT#tenant-active#AUDIT#202608",
      SK: "EVT#2026-08-20T00:00:00.000Z#a2",
      occurredAt: "2026-08-20T00:00:00.000Z",
    });
    const nonActiveTenant = makeCandidate({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#AUDIT#202601", SK: "EVT#2026-01-01T00:00:00.000Z#a3" });
    candidates.seed(eligibleAudit);
    candidates.seed(eligibleMembership);
    candidates.seed(eligibleSubject);
    candidates.seed(eligibleTenant);
    candidates.seed(tooRecent);
    candidates.seed(nonActiveTenant);

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 6, purged: 4, skippedTooRecent: 1, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: eligibleAudit.PK, SK: eligibleAudit.SK })).toBeUndefined();
    expect(candidates.get({ PK: eligibleMembership.PK, SK: eligibleMembership.SK })).toBeUndefined();
    expect(candidates.get({ PK: eligibleSubject.PK, SK: eligibleSubject.SK })).toBeUndefined();
    expect(candidates.get({ PK: eligibleTenant.PK, SK: eligibleTenant.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecent.PK, SK: tooRecent.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenant.PK, SK: nonActiveTenant.SK })).toBeDefined();
  });

  it("drains multiple scan pages within one run", async () => {
    const candidates = new FakeSecurityAuditPurgeCandidateSource();
    candidates.pageSize = 1;
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-1", "ACTIVE");
    const a = makeCandidate({ PK: "TENANT#tenant-1#AUDIT#202601", SK: "EVT#2026-01-01T00:00:00.000Z#a" });
    const b = makeCandidate({ PK: "TENANT#tenant-1#AUDIT#202601", SK: "EVT#2026-01-01T00:00:00.000Z#b" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runSecurityAuditPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });
});
