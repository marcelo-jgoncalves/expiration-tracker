/**
 * D-179/D-188 GSI8 backfill script coverage (slice 7, transient-purge) — mirrors
 * `backfill-gsi8-security-audit-purge.test.ts` exactly, adapted for TWO entity types with real
 * `version` fields and the RESERVED-UploadSlot exclusion. Covers `processPage`'s pure decision
 * logic (a WebhookInbox row is always a candidate; an UploadSlot row is a candidate UNLESS
 * RESERVED; FUTURE-due rows are included, not only already-overdue ones) and the
 * `encodeKey`/`decodeKey`/`parseArgs`/`deriveDue` pure helpers - not the real Scan/UpdateItem
 * entrypoint, which needs a live table and is exercised manually per the script's own `--dry-run`
 * mode.
 */
import { describe, expect, it } from "vitest";
import { decodeKey, deriveDue, encodeKey, parseArgs, processPage } from "../../../scripts/backfill-gsi8-transient-purge.js";
import type { TransientGsi8EntityType } from "../../../src/shared/transient-purge-gsi8.js";
import type { UploadSlotStatus } from "../../../src/modules/document/domain/upload-slot.js";

function makeWebhookInboxRow(
  overrides: Partial<{ PK: string; SK: string; tenantId: string; createdAt: string; version: number; GSI8PK?: string; GSI8SK?: string }> = {},
) {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#WEBHOOK#SES#acct-1`,
    SK: "EVENT#sns-1",
    entityType: "WebhookInbox" as TransientGsi8EntityType,
    tenantId,
    createdAt: "2025-07-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeUploadSlotRow(
  overrides: Partial<{ PK: string; SK: string; tenantId: string; reservedAt: string; status: UploadSlotStatus; version: number; GSI8PK?: string; GSI8SK?: string }> = {},
) {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#UPLOAD`,
    SK: "SLOT#slot-1",
    entityType: "UploadSlot" as TransientGsi8EntityType,
    tenantId,
    reservedAt: "2025-07-01T00:00:00.000Z",
    status: "EXPIRED" as UploadSlotStatus,
    version: 1,
    ...overrides,
  };
}

describe("backfill-gsi8-transient-purge: parseArgs", () => {
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

describe("backfill-gsi8-transient-purge: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#tenant-1#UPLOAD", SK: "SLOT#slot-1" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("round-trips undefined as undefined", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-gsi8-transient-purge: deriveDue", () => {
  it("always returns a due date for WebhookInbox", () => {
    expect(deriveDue(makeWebhookInboxRow())).toBeDefined();
  });

  it("returns undefined for a RESERVED UploadSlot - never a candidate", () => {
    expect(deriveDue(makeUploadSlotRow({ status: "RESERVED" }))).toBeUndefined();
  });

  it.each(["CONSUMED", "EXPIRED", "RELEASED"] as const)("returns a due date for a %s UploadSlot", (status) => {
    expect(deriveDue(makeUploadSlotRow({ status }))).toBeDefined();
  });

  it("throws for a WebhookInbox row missing createdAt", () => {
    const row = { ...makeWebhookInboxRow(), createdAt: undefined as unknown as string };
    expect(() => deriveDue(row)).toThrow(/missing createdAt/);
  });

  it("throws for an UploadSlot row missing reservedAt/status", () => {
    const row = { ...makeUploadSlotRow(), status: undefined as unknown as UploadSlotStatus };
    expect(() => deriveDue(row)).toThrow(/missing reservedAt\/status/);
  });
});

describe("backfill-gsi8-transient-purge: processPage", () => {
  // Same Round 3 -> 4 correction as every other worker's backfill: a row whose due date is still
  // in the FUTURE is STILL a candidate - it gets a pointer with a future GSI8SK, not "skipped
  // until due".
  it("writes a pointer for a WebhookInbox row whose due date is still in the FUTURE, not only already-overdue ones", async () => {
    const row = makeWebhookInboxRow({ createdAt: "2026-08-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([row], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0, skippedNotCandidate: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#TRANSIENT");
    expect(writes[0]!.gsi8sk).toBe("2026-08-08T00:00:00.000Z#TENANT#tenant-1#WebhookInbox#EVENT#sns-1");
  });

  it("writes a pointer for a CONSUMED UploadSlot row using the 7-day confirmed window", async () => {
    const row = makeUploadSlotRow({ status: "CONSUMED", reservedAt: "2025-07-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([row], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0, skippedNotCandidate: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#TRANSIENT");
    expect(writes[0]!.gsi8sk).toBe("2025-07-08T00:00:00.000Z#TENANT#tenant-1#UploadSlot#SLOT#slot-1");
  });

  it("writes a pointer for an EXPIRED UploadSlot row using the 24h incomplete window", async () => {
    const row = makeUploadSlotRow({ status: "EXPIRED", reservedAt: "2025-07-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    await processPage([row], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(writes[0]!.gsi8sk).toBe("2025-07-02T00:00:00.000Z#TENANT#tenant-1#UploadSlot#SLOT#slot-1");
  });

  it("never writes a pointer for a RESERVED UploadSlot, counted separately as skippedNotCandidate", async () => {
    const row = makeUploadSlotRow({ status: "RESERVED" });
    const writes: unknown[] = [];
    const result = await processPage([row], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 0, pointersWritten: 0, alreadyPointed: 0, skippedNotCandidate: 1 });
    expect(writes).toHaveLength(0);
  });

  it("counts (but never overwrites) a row that already has a GSI8 pointer", async () => {
    const row = makeWebhookInboxRow({ GSI8PK: "WORK#TRANSIENT", GSI8SK: "2026-07-01T00:00:00.000Z#TENANT#tenant-1#WebhookInbox#EVENT#sns-1" });
    const writes: unknown[] = [];
    const result = await processPage([row], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 1, skippedNotCandidate: 0 });
    expect(writes).toHaveLength(0);
  });

  it("--dry-run reports candidates without calling writePointer", async () => {
    const row = makeWebhookInboxRow();
    const writes: unknown[] = [];
    const result = await processPage([row], true, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0, skippedNotCandidate: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does not count pointersWritten when writePointer reports a lost race (false)", async () => {
    const row = makeWebhookInboxRow();
    const result = await processPage([row], false, async () => false);
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0, skippedNotCandidate: 0 });
  });

  it("processes a mixed page of WebhookInbox/UploadSlot(CONSUMED/RESERVED) rows correctly", async () => {
    const inbox = makeWebhookInboxRow();
    const consumedSlot = makeUploadSlotRow({ status: "CONSUMED", SK: "SLOT#slot-consumed" });
    const reservedSlot = makeUploadSlotRow({ status: "RESERVED", SK: "SLOT#slot-reserved" });
    const result = await processPage([inbox, consumedSlot, reservedSlot], false, async () => true);
    expect(result).toEqual({ candidatesFound: 2, pointersWritten: 2, alreadyPointed: 0, skippedNotCandidate: 1 });
  });
});
