/**
 * D-179 slice 3 GSI8 backfill script coverage (document-file-reconciliation) — mirrors
 * `backfill-gsi8-invitation-purge.test.ts` exactly. Covers `processPage`'s pure decision logic and
 * the `encodeKey`/`decodeKey`/`parseArgs` pure helpers - not the real Scan/UpdateItem entrypoint,
 * which needs a live table and is exercised manually per the script's own `--dry-run` mode.
 */
import { describe, expect, it } from "vitest";
import { decodeKey, encodeKey, parseArgs, processPage } from "../../../scripts/backfill-gsi8-document-file-reconciliation.js";
import type { DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";

function makeFile(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    PK: "TENANT#t1#DOCUMENT#doc-1",
    SK: "VERSION#000001#FILE#file-1",
    entityType: "DocumentFile",
    tenantId: "t1",
    documentId: "doc-1",
    versionId: "v-1",
    seq: 1,
    fileId: "file-1",
    role: "PRINCIPAL",
    scanStatus: "PENDING_UPLOAD",
    mediaType: "application/pdf",
    contentLength: 1024,
    checksumSha256: "a".repeat(64),
    quarantineObject: { bucket: "quarantine-bucket", key: "document-archive/tenant/t1/document/doc-1/version/1/file/file-1", versionId: "" },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("backfill-gsi8-document-file-reconciliation: parseArgs", () => {
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

describe("backfill-gsi8-document-file-reconciliation: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#t1#DOCUMENT#doc-1", SK: "VERSION#000001#FILE#file-1" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("round-trips undefined as undefined", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-gsi8-document-file-reconciliation: processPage", () => {
  it("skips a terminal (CLEAN) DocumentFile (deriveDocumentFileMaintenanceDue returns undefined)", async () => {
    const writes: unknown[] = [];
    const result = await processPage([makeFile({ scanStatus: "CLEAN" })], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 0, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("writes a pointer for a PENDING_UPLOAD file whose due date is still in the FUTURE, not only already-overdue ones", async () => {
    const file = makeFile({ scanStatus: "PENDING_UPLOAD", createdAt: "2026-09-01T00:00:00.000Z" }); // due 600s later
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([file], false, async (f, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8pk).toBe("WORK#DOCUMENT_FILE_RECONCILIATION");
    expect(writes[0]!.gsi8sk).toBe("2026-09-01T00:10:00.000Z#TENANT#t1#file-1");
  });

  it("writes a pointer for a SCANNING file the same way as PENDING_UPLOAD (same fixed window, no separate clock)", async () => {
    const file = makeFile({ scanStatus: "SCANNING", createdAt: "2026-01-01T00:00:00.000Z" });
    const writes: Array<{ gsi8pk: string; gsi8sk: string }> = [];
    const result = await processPage([file], false, async (f, gsi8) => {
      writes.push({ gsi8pk: gsi8.GSI8PK, gsi8sk: gsi8.GSI8SK });
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 1, alreadyPointed: 0 });
    expect(writes[0]!.gsi8sk).toBe("2026-01-01T00:10:00.000Z#TENANT#t1#file-1");
  });

  it("counts (but never overwrites) a row that already has a GSI8 pointer", async () => {
    const file = makeFile({
      scanStatus: "PENDING_UPLOAD",
      GSI8PK: "WORK#DOCUMENT_FILE_RECONCILIATION",
      GSI8SK: "2026-09-01T00:10:00.000Z#TENANT#t1#file-1",
    });
    const writes: unknown[] = [];
    const result = await processPage([file], false, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 1 });
    expect(writes).toHaveLength(0);
  });

  it("--dry-run reports candidates without calling writePointer", async () => {
    const file = makeFile({ scanStatus: "PENDING_UPLOAD" });
    const writes: unknown[] = [];
    const result = await processPage([file], true, async () => {
      writes.push(1);
      return true;
    });
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does not count pointersWritten when writePointer reports a lost race (false)", async () => {
    const file = makeFile({ scanStatus: "PENDING_UPLOAD" });
    const result = await processPage([file], false, async () => false);
    expect(result).toEqual({ candidatesFound: 1, pointersWritten: 0, alreadyPointed: 0 });
  });
});
