/**
 * D-179/D-187 GSI8 backfill script coverage (slice 6, security-audit-purge) — mirrors
 * `backfill-gsi8-quota-telemetry-purge.test.ts` exactly, adapted for FOUR entity types, no
 * `version` field, and the `MembershipAuditEvent`/`organizationId` normalization. Covers
 * `processPage`'s pure decision logic (every row is always a candidate -
 * `deriveSecurityAuditMaintenanceDue()` never returns `undefined` - and FUTURE-due rows are
 * included, not only already-overdue ones) and the `encodeKey`/`decodeKey`/`parseArgs`/
 * `normalizeTenantId` pure helpers - not the real Scan/UpdateItem entrypoint, which needs a live
 * table and is exercised manually per the script's own `--dry-run` mode.
 */
import { describe, expect, it } from "vitest";
import { decodeKey, encodeKey, normalizeTenantId, parseArgs, processPage } from "../../../scripts/backfill-gsi8-security-audit-purge.js";
import type { SecurityAuditGsi8EntityType } from "../../../src/shared/security-audit-gsi8.js";

function makeRow(
  overrides: Partial<{
    PK: string;
    SK: string;
    entityType: SecurityAuditGsi8EntityType;
    tenantId?: string;
    organizationId?: string;
    occurredAt: string;
    GSI8PK?: string;
    GSI8SK?: string;
  }> = {},
) {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#AUDIT#202507`,
    SK: "EVT#2025-07-01T00:00:00.000Z#evt-1",
    entityType: "AuditEvent" as const,
    tenantId,
    occurredAt: "2025-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("backfill-gsi8-security-audit-purge: parseArgs", () => {
  it("parses --table, --after, --page-size, --dry-run", () => {
    const args = parseArgs(["--table", "MainTable", "--after", "abc123", "--page-size", "50", "--dry-run"]);
    expect(args).toEqual({ table: "MainTable", after: "abc123", pageSize: 50, dryRun: true });
  });

  it("defaults pageSize to 25 and dryRun to false", () => {
    const args = parseArgs(["--table", "MainTable"]);
    expect(args.pageSize).toBe(25);
    expect(args.dryRun).toBe(false);
  });

  it("throws if --table is missing", () => {
    expect(() => parseArgs([])).toThrow("--table");
  });
});

describe("backfill-gsi8-security-audit-purge: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#tenant-1#AUDIT#202507", SK: "EVT#2025-07-01T00:00:00.000Z#evt-1" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("round-trips undefined as undefined", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-gsi8-security-audit-purge: normalizeTenantId", () => {
  it("passes tenantId through for the 3 entities that carry it directly", () => {
    expect(normalizeTenantId(makeRow({ tenantId: "t1" }))).toBe("t1");
  });

  it("maps organizationId -> tenantId for MembershipAuditEvent", () => {
    const row = makeRow({ entityType: "MembershipAuditEvent", tenantId: undefined, organizationId: "org-1" });
    expect(normalizeTenantId(row)).toBe("org-1");
  });

  it("throws when a row has neither field", () => {
    const row = makeRow({ tenantId: undefined });
    expect(() => normalizeTenantId(row)).toThrow(/neither tenantId nor organizationId/);
  });
});

describe("backfill-gsi8-security-audit-purge: processPage", () => {
  // Same Round 3 -> 4 correction as every other worker's backfill: a row whose due date is still
  // in the FUTURE is STILL a candidate - it gets a pointer with a future GSI8SK, not "skipped
  // until due".
  it("writes a pointer for an AuditEvent row whose due date is still in the FUTURE, not only already-overdue ones", async () => {
    const row = makeRow({ occurredAt: "2026-08-01T00:00:00.000Z", SK: "EVT#2026-08-01T00:00:00.000Z#evt-future" }); // future occurredAt, due 365d after
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([row], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#SECURITY_AUDIT");
    expect(writes[0]!.gsi8sk).toBe("2027-08-01T00:00:00.000Z#TENANT#tenant-1#AuditEvent#EVT#2026-08-01T00:00:00.000Z#evt-future");
  });

  it("writes a pointer for a MembershipAuditEvent row (organizationId normalized to tenantId) whose due date is already overdue", async () => {
    const row = makeRow({
      entityType: "MembershipAuditEvent",
      tenantId: undefined,
      organizationId: "org-1",
      PK: "TENANT#org-1#MEMBERSHIPAUDIT#202507",
      SK: "EVT#2025-07-01T00:00:00.000Z#evt-2",
      occurredAt: "2025-07-01T00:00:00.000Z",
    });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([row], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#SECURITY_AUDIT");
    expect(writes[0]!.gsi8sk).toBe("2026-07-01T00:00:00.000Z#TENANT#org-1#MembershipAuditEvent#EVT#2025-07-01T00:00:00.000Z#evt-2");
  });

  it.each(["SubjectAuditEvent", "TenantAuditEvent"] as const)("writes a pointer for a %s row", async (entityType) => {
    const row = makeRow({ entityType, SK: `EVT#2025-07-01T00:00:00.000Z#evt-${entityType}` });
    const result = await processPage([row], false, async () => true);
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
  });

  it("counts (but never overwrites) a row that already has a GSI8 pointer", async () => {
    const row = makeRow({ GSI8PK: "WORK#SECURITY_AUDIT", GSI8SK: "2026-07-01T00:00:00.000Z#TENANT#tenant-1#AuditEvent#EVT#2025-07-01T00:00:00.000Z#evt-1" });
    const writes: unknown[] = [];
    const result = await processPage([row], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 1 });
    expect(writes).toHaveLength(0);
  });

  it("--dry-run reports candidates without calling writePointer", async () => {
    const row = makeRow();
    const writes: unknown[] = [];
    const result = await processPage([row], true, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does not count pointersWritten when writePointer reports a lost race (false)", async () => {
    const row = makeRow();
    const result = await processPage([row], false, async () => false);
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
  });
});
