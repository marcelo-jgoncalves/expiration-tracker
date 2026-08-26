import { describe, expect, it } from "vitest";
import { parseCleanKey } from "../../../src/modules/document/domain/clean-key.js";

describe("parseCleanKey", () => {
  it("parses a real key shape produced by advanceAfterEvidence's promotion copy", () => {
    const parsed = parseCleanKey("clean/t1/item1/doc1");
    expect(parsed).toEqual({ tenantId: "t1", itemId: "item1", documentId: "doc1" });
  });

  it("returns undefined for a key that doesn't match the expected shape", () => {
    expect(parseCleanKey("some/random/key")).toBeUndefined();
    expect(parseCleanKey("clean/t1/doc1")).toBeUndefined(); // pre-M7 2-segment shape, no longer produced
    expect(parseCleanKey("")).toBeUndefined();
  });
});
