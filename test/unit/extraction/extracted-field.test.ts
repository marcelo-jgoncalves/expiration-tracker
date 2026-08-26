import { describe, expect, it } from "vitest";
import { extractedFieldKey } from "../../../src/modules/extraction/domain/extracted-field.js";

describe("extractedFieldKey", () => {
  it("shares the ExtractionRun's PK and uses SK FIELD#<fieldName>#<runId> (data-model.md line 107)", () => {
    expect(extractedFieldKey("tenant-1", "doc-1", "expirationDate", "run-abc")).toEqual({
      PK: "TENANT#tenant-1#DOC#doc-1",
      SK: "FIELD#expirationDate#run-abc",
    });
  });
});
