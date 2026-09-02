/**
 * D-179/D-181 GSI8 backfill script coverage (slice 2, invitation-purge) — mirrors
 * `backfill-gsi8-membership-purge.test.ts` exactly. Covers `processPage`'s pure decision logic
 * (which rows get a pointer, and that FUTURE-due rows are included for BOTH branches - REVOKED and
 * PENDING) and the `encodeKey`/`decodeKey`/`parseArgs` pure helpers - not the real
 * Scan/UpdateItem entrypoint, which needs a live table and is exercised manually per the script's
 * own `--dry-run` mode.
 */
import { describe, expect, it } from "vitest";
import { decodeKey, encodeKey, parseArgs, processPage } from "../../../scripts/backfill-gsi8-invitation-purge.js";
import type { Invitation } from "../../../src/modules/organization/domain/invitation.js";

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    PK: "TENANT#org-1#ORG#org-1",
    SK: "INVITATION#inv-1",
    entityType: "Invitation",
    invitationId: "inv-1",
    organizationId: "org-1",
    emailNormalized: "user@example.com",
    role: "MEMBER",
    status: "PENDING",
    tokenPointerId: "selector-hash",
    expiresAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-owner",
    createdAt: "2025-12-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("backfill-gsi8-invitation-purge: parseArgs", () => {
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

describe("backfill-gsi8-invitation-purge: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#org-1#ORG#org-1", SK: "INVITATION#inv-1" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("round-trips undefined as undefined", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-gsi8-invitation-purge: processPage", () => {
  it("skips an ACCEPTED Invitation (deriveInvitationMaintenanceDue returns undefined)", async () => {
    const writes: unknown[] = [];
    const result = await processPage([makeInvitation({ status: "ACCEPTED" })], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 0, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  // Same Round 3 -> 4 correction as membership-purge's backfill: a PENDING row whose due date is
  // still in the FUTURE is STILL a candidate - it gets a pointer with a future GSI8SK, not
  // "skipped until due". Both branches need this (REVOKED and PENDING), see the second test below.
  it("writes a pointer for a PENDING invitation whose due date is still in the FUTURE, not only already-overdue ones", async () => {
    const invitation = makeInvitation({ status: "PENDING", expiresAt: "2026-08-30T00:00:00.000Z" }); // future expiry, due 30d after that
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([invitation], false, async (i, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#INVITATION_PURGE");
    expect(writes[0]!.gsi8sk).toBe("2026-09-29T00:00:00.000Z#TENANT#org-1#inv-1");
  });

  it("writes a pointer for a REVOKED invitation whose due date is already overdue", async () => {
    const invitation = makeInvitation({ status: "REVOKED", revokedAt: "2026-07-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([invitation], false, async (i, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#INVITATION_PURGE");
    expect(writes[0]!.gsi8sk).toBe("2026-07-31T00:00:00.000Z#TENANT#org-1#inv-1");
  });

  it("counts (but never overwrites) a row that already has a GSI8 pointer", async () => {
    const invitation = makeInvitation({
      status: "REVOKED",
      revokedAt: "2026-07-01T00:00:00.000Z",
      GSI8PK: "WORK#INVITATION_PURGE",
      GSI8SK: "2026-07-31T00:00:00.000Z#TENANT#org-1#inv-1",
    });
    const writes: unknown[] = [];
    const result = await processPage([invitation], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 1 });
    expect(writes).toHaveLength(0);
  });

  it("--dry-run reports candidates without calling writePointer", async () => {
    const invitation = makeInvitation({ status: "REVOKED", revokedAt: "2026-07-01T00:00:00.000Z" });
    const writes: unknown[] = [];
    const result = await processPage([invitation], true, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does not count pointersWritten when writePointer reports a lost race (false)", async () => {
    const invitation = makeInvitation({ status: "REVOKED", revokedAt: "2026-07-01T00:00:00.000Z" });
    const result = await processPage([invitation], false, async () => false);
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
  });
});
