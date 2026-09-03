import { describe, expect, it } from "vitest";
import { parseDocumentArchiveCleanKey } from "../../../src/modules/document-archive/domain/document-archive-clean-key.js";
import { buildDocumentArchiveCleanKey } from "../../../src/modules/document-archive/application/advance-file-after-evidence.js";

describe("parseDocumentArchiveCleanKey", () => {
  it("round-trips buildDocumentArchiveCleanKey's exact output", () => {
    const key = buildDocumentArchiveCleanKey("t1", "doc1", "ver-5", "file1");
    expect(parseDocumentArchiveCleanKey(key)).toEqual({ tenantId: "t1", documentId: "doc1", versionId: "ver-5", fileId: "file1" });
  });

  it("returns undefined for a key missing a segment", () => {
    expect(parseDocumentArchiveCleanKey("document-archive/clean/t1/doc1/ver-5")).toBeUndefined();
  });

  it("never collides with the OLD module's clean/<tenantId>/<itemId>/<documentId> shape", () => {
    expect(parseDocumentArchiveCleanKey("clean/t1/item1/doc1")).toBeUndefined();
  });

  it("returns undefined for an unrelated key", () => {
    expect(parseDocumentArchiveCleanKey("document-archive/tenant/t1/document/doc1/version/1/file/file1")).toBeUndefined();
  });
});
