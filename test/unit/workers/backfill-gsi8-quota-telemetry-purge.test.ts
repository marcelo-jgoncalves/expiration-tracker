/**
 * D-179/D-186 GSI8 backfill script coverage (slice 5, quota-telemetry-purge) — mirrors
 * `backfill-gsi8-invitation-purge.test.ts` exactly, adapted for two entity types and no
 * `version` field. Covers `processPage`'s pure decision logic (every row is always a candidate -
 * `deriveQuotaTelemetryMaintenanceDue()` never returns `undefined` - and FUTURE-due rows are
 * included, not only already-overdue ones) and the `encodeKey`/`decodeKey`/`parseArgs` pure
 * helpers - not the real Scan/UpdateItem entrypoint, which needs a live table and is exercised
 * manually per the script's own `--dry-run` mode.
 */
import { describe, expect, it } from "vitest";
import { decodeKey, encodeKey, parseArgs, processPage } from "../../../scripts/backfill-gsi8-quota-telemetry-purge.js";

function makeRow(overrides: Partial<{ PK: string; SK: string; entityType: "TenantQuota" | "EphemeralTelemetryMutation"; tenantId: string; resetAt: string; GSI8PK?: string; GSI8SK?: string }> = {}) {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#QUOTA`,
    SK: "TYPE#AI_CALL#w1",
    entityType: "TenantQuota" as const,
    tenantId,
    resetAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("backfill-gsi8-quota-telemetry-purge: parseArgs", () => {
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

describe("backfill-gsi8-quota-telemetry-purge: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#tenant-1#QUOTA", SK: "TYPE#AI_CALL#w1" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("round-trips undefined as undefined", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-gsi8-quota-telemetry-purge: processPage", () => {
  // Same Round 3 -> 4 correction as membership-purge/invitation-purge's backfill: a row whose due
  // date is still in the FUTURE is STILL a candidate - it gets a pointer with a future GSI8SK,
  // not "skipped until due".
  it("writes a pointer for a TenantQuota row whose due date is still in the FUTURE, not only already-overdue ones", async () => {
    const row = makeRow({ resetAt: "2026-08-30T00:00:00.000Z" }); // future resetAt, due 30d after
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([row], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#QUOTA_TELEMETRY");
    expect(writes[0]!.gsi8sk).toBe("2026-09-29T00:00:00.000Z#TENANT#tenant-1#TenantQuota#TYPE#AI_CALL#w1");
  });

  it("writes a pointer for an EphemeralTelemetryMutation row whose due date is already overdue", async () => {
    const row = makeRow({ entityType: "EphemeralTelemetryMutation", SK: "TYPE#API_REQUEST#123456", resetAt: "2026-07-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([row], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#QUOTA_TELEMETRY");
    expect(writes[0]!.gsi8sk).toBe("2026-07-31T00:00:00.000Z#TENANT#tenant-1#EphemeralTelemetryMutation#TYPE#API_REQUEST#123456");
  });

  it("counts (but never overwrites) a row that already has a GSI8 pointer", async () => {
    const row = makeRow({ GSI8PK: "WORK#QUOTA_TELEMETRY", GSI8SK: "2026-07-31T00:00:00.000Z#TENANT#tenant-1#TenantQuota#TYPE#AI_CALL#w1" });
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
