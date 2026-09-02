/**
 * D-179 slice 4 GSI8 backfill script coverage (requirement-reindex) — mirrors
 * `backfill-gsi8-document-file-reconciliation.test.ts` exactly. Covers `processPage`'s pure
 * decision logic and the `encodeKey`/`decodeKey`/`parseArgs` pure helpers - not the real
 * Scan/UpdateItem entrypoint, which needs a live table and is exercised manually per the script's
 * own `--dry-run` mode.
 */
import { describe, expect, it } from "vitest";
import { decodeKey, encodeKey, parseArgs, processPage } from "../../../scripts/backfill-gsi8-requirement-reindex.js";
import { requirementKey, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";

function makeRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    ...requirementKey("t1", "subject-1", "req-1"),
    entityType: "Requirement",
    requirementId: "req-1",
    tenantId: "t1",
    subjectId: "subject-1",
    name: "CND Federal",
    applicability: "APPLICABLE",
    status: "SATISFIED",
    evidenceVersionId: "ver-1",
    evidenceDocumentId: "doc-1",
    evidenceSeq: 1,
    evidenceState: "ACCEPTED",
    evidenceValidUntil: "2026-12-31T00:00:00.000Z",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version: 1,
    GSI1PK: "TENANT#t1#REQSTATUS#SATISFIED",
    GSI1SK: "UPDATED#2026-08-30T00:00:00.000Z#REQUIREMENT#req-1",
    ...overrides,
  };
}

describe("backfill-gsi8-requirement-reindex: parseArgs", () => {
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

describe("backfill-gsi8-requirement-reindex: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#t1#SUBJECT#subject-1", SK: "REQUIREMENT#req-1" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("round-trips undefined as undefined", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-gsi8-requirement-reindex: processPage", () => {
  it("skips a Requirement with no evidenceValidUntil (deriveRequirementMaintenanceDue returns undefined - SATISFIED forever)", async () => {
    const writes: unknown[] = [];
    const result = await processPage([makeRequirement({ evidenceValidUntil: undefined })], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 0, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("skips a non-SATISFIED Requirement even if it carries a stale evidenceValidUntil", async () => {
    const writes: unknown[] = [];
    const result = await processPage([makeRequirement({ status: "NOT_SATISFIED" })], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 0, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("writes a pointer for a SATISFIED Requirement whose evidenceValidUntil is still in the FUTURE, not only already-overdue ones", async () => {
    const requirement = makeRequirement({ evidenceValidUntil: "2027-06-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([requirement], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#REQUIREMENT_REINDEX");
    expect(writes[0]!.gsi8sk).toBe("2027-06-01T00:00:00.000Z#TENANT#t1#REQUIREMENT#req-1");
  });

  it("writes a pointer for an already-overdue SATISFIED Requirement the same way", async () => {
    const requirement = makeRequirement({ evidenceValidUntil: "2026-01-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([requirement], false, async (r, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8sk).toBe("2026-01-01T00:00:00.000Z#TENANT#t1#REQUIREMENT#req-1");
  });

  it("counts (but never overwrites) a row that already has a GSI8 pointer", async () => {
    const requirement = makeRequirement({ GSI8PK: "WORK#REQUIREMENT_REINDEX", GSI8SK: "2026-12-31T00:00:00.000Z#TENANT#t1#REQUIREMENT#req-1" });
    const writes: unknown[] = [];
    const result = await processPage([requirement], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 1 });
    expect(writes).toHaveLength(0);
  });

  it("--dry-run reports candidates without calling writePointer", async () => {
    const requirement = makeRequirement();
    const writes: unknown[] = [];
    const result = await processPage([requirement], true, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does not count pointersWritten when writePointer reports a lost race (false)", async () => {
    const requirement = makeRequirement();
    const result = await processPage([requirement], false, async () => false);
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
  });
});
