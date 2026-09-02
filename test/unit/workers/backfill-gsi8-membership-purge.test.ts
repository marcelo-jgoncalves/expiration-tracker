/**
 * D-179/D-180 GSI8 backfill script coverage. Covers `processPage`'s pure decision logic (which
 * rows get a pointer, and that FUTURE-due rows are included - the Round 3->4 correction the
 * approved design names explicitly) and the `encodeKey`/`decodeKey`/`parseArgs` pure helpers -
 * not the real Scan/UpdateItem entrypoint, which needs a live table and is exercised manually per
 * the script's own `--dry-run` mode.
 */
import { describe, expect, it } from "vitest";
import { decodeKey, encodeKey, parseArgs, processPage } from "../../../scripts/backfill-gsi8-membership-purge.js";
import type { Membership } from "../../../src/modules/organization/domain/membership.js";

function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    PK: "TENANT#org-1#ORG#org-1",
    SK: "MEMBER#user-1",
    entityType: "Membership",
    membershipId: "membership-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "MEMBER",
    status: "ACTIVE",
    joinedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-owner",
    version: 1,
    GSI4PK: "USER#user-1",
    GSI4SK: "ORG#org-1#MEMBERSHIP#membership-1",
    ...overrides,
  };
}

describe("backfill-gsi8-membership-purge: parseArgs", () => {
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

describe("backfill-gsi8-membership-purge: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#org-1#ORG#org-1", SK: "MEMBER#user-1" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("round-trips undefined as undefined", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-gsi8-membership-purge: processPage", () => {
  it("skips a Membership that is not REMOVED (deriveMembershipMaintenanceDue returns undefined)", async () => {
    const writes: unknown[] = [];
    const result = await processPage([makeMembership({ status: "ACTIVE" })], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 0, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  // The Round 3 -> 4 correction the approved design names explicitly (estado-final-consolidado.md
  // item 6): a REMOVED row far from its 30-day due date is STILL a candidate - it gets a pointer
  // with a future GSI8SK, not "skipped until due".
  it("writes a pointer for a REMOVED membership whose due date is still in the FUTURE, not only already-overdue ones", async () => {
    const membership = makeMembership({ status: "REMOVED", removedAt: "2026-08-30T00:00:00.000Z" }); // 2 days ago, due date ~28 days out
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([membership], false, async (m, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#MEMBERSHIP_PURGE");
    expect(writes[0]!.gsi8sk).toBe("2026-09-29T00:00:00.000Z#TENANT#org-1#membership-1");
  });

  it("counts (but never overwrites) a row that already has a GSI8 pointer", async () => {
    const membership = makeMembership({
      status: "REMOVED",
      removedAt: "2026-07-01T00:00:00.000Z",
      GSI8PK: "WORK#MEMBERSHIP_PURGE",
      GSI8SK: "2026-07-31T00:00:00.000Z#TENANT#org-1#membership-1",
    });
    const writes: unknown[] = [];
    const result = await processPage([membership], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 1 });
    expect(writes).toHaveLength(0);
  });

  it("--dry-run reports candidates without calling writePointer", async () => {
    const membership = makeMembership({ status: "REMOVED", removedAt: "2026-07-01T00:00:00.000Z" });
    const writes: unknown[] = [];
    const result = await processPage([membership], true, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does not count pointersWritten when writePointer reports a lost race (false)", async () => {
    const membership = makeMembership({ status: "REMOVED", removedAt: "2026-07-01T00:00:00.000Z" });
    const result = await processPage([membership], false, async () => false);
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
  });
});
