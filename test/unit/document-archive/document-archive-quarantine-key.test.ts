import { describe, expect, it } from "vitest";
import { parseDocumentArchiveQuarantineKey } from "../../../src/modules/document-archive/domain/document-archive-quarantine-key.js";
import { parseQuarantineKey } from "../../../src/modules/document/domain/quarantine-key.js";
import { parseSubmissionQuarantineKey } from "../../../src/modules/subject/domain/submission-quarantine-key.js";

const REAL_KEY = "document-archive/tenant/t1/document/doc1/version/3/file/file1";

describe("parseDocumentArchiveQuarantineKey — D-193 slice 1", () => {
  it("D-193 adversarial: reproduces the real production bug this slice fixes — a document-archive key was previously recognized by NEITHER existing parser and would have been silently dropped forever", () => {
    // Before this slice, upload-finalizer-handler.ts/malware-result-handler.ts only ever tried
    // these two parsers - both reject the real key `DocumentArchiveService.buildQuarantineKey()`
    // produces, which is exactly the bug: it fell through to "unrecognized key shape" and was
    // logged+dropped with no retry/DLQ, leaving the DocumentFile stuck in PENDING_UPLOAD forever.
    expect(parseQuarantineKey(REAL_KEY)).toBeUndefined();
    expect(parseSubmissionQuarantineKey(REAL_KEY)).toBeUndefined();
    // The fix: the new parser DOES recognize it, with every field correctly extracted.
    expect(parseDocumentArchiveQuarantineKey(REAL_KEY)).toEqual({ tenantId: "t1", documentId: "doc1", seq: 3, fileId: "file1" });
  });

  it("parses tenantId/documentId/seq/fileId from the exact shape buildQuarantineKey() produces", () => {
    expect(parseDocumentArchiveQuarantineKey("document-archive/tenant/tenant-abc/document/doc-xyz/version/12/file/file-1")).toEqual({
      tenantId: "tenant-abc",
      documentId: "doc-xyz",
      seq: 12,
      fileId: "file-1",
    });
  });

  it("regression: old M6 item-anchored keys are completely unaffected — never matched by the new parser", () => {
    expect(parseDocumentArchiveQuarantineKey("tenant/t1/item/item1/document/doc1/slot/slot1/random")).toBeUndefined();
  });

  it("regression: old M10 guest-submission keys are completely unaffected — never matched by the new parser", () => {
    expect(parseDocumentArchiveQuarantineKey("tenant/t1/subject/s1/assignment/a1/submission/sub1/document/doc1/slot/slot1/random")).toBeUndefined();
  });

  it("regression: the new document-archive format is never matched by either OLD parser (no accidental double-match)", () => {
    expect(parseQuarantineKey(REAL_KEY)).toBeUndefined();
    expect(parseSubmissionQuarantineKey(REAL_KEY)).toBeUndefined();
  });

  it("rejects a malformed/incomplete key (missing file segment)", () => {
    expect(parseDocumentArchiveQuarantineKey("document-archive/tenant/t1/document/doc1/version/3")).toBeUndefined();
  });

  it("rejects a non-numeric seq segment", () => {
    expect(parseDocumentArchiveQuarantineKey("document-archive/tenant/t1/document/doc1/version/not-a-number/file/file1")).toBeUndefined();
  });

  it("rejects seq=0 (versions are 1-based)", () => {
    expect(parseDocumentArchiveQuarantineKey("document-archive/tenant/t1/document/doc1/version/0/file/file1")).toBeUndefined();
  });

  it("rejects an empty string and an unrelated key", () => {
    expect(parseDocumentArchiveQuarantineKey("")).toBeUndefined();
    expect(parseDocumentArchiveQuarantineKey("some/other/key")).toBeUndefined();
  });
});
