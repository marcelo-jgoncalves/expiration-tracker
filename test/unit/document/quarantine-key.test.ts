import { describe, expect, it } from "vitest";
import { parseQuarantineKey } from "../../../src/modules/document/domain/quarantine-key.js";

describe("parseQuarantineKey", () => {
  it("parses a real key shape produced by DocumentService.reserveUpload", () => {
    const parsed = parseQuarantineKey("tenant/t1/item/item1/document/doc1/slot/slot1/abcdef123");
    expect(parsed).toEqual({ tenantId: "t1", itemId: "item1", documentId: "doc1", uploadSlotId: "slot1" });
  });

  it("returns undefined for a key that doesn't match the expected shape", () => {
    expect(parseQuarantineKey("some/random/key")).toBeUndefined();
    expect(parseQuarantineKey("")).toBeUndefined();
  });
});
