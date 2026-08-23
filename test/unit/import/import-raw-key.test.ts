import { describe, expect, it } from "vitest";
import { parseImportRawKey } from "../../../src/modules/import/domain/import-raw-key.js";

describe("parseImportRawKey", () => {
  it("parses a real key shape produced by ImportService.reserveImport", () => {
    const parsed = parseImportRawKey("tenant/t1/imports/importjob-1/raw.csv");
    expect(parsed).toEqual({ tenantId: "t1", jobId: "importjob-1" });
  });

  it("returns undefined for a key that doesn't match the expected shape", () => {
    expect(parseImportRawKey("some/random/key")).toBeUndefined();
    expect(parseImportRawKey("")).toBeUndefined();
  });

  it("returns undefined for the parse worker's OWN plan JSONL write, never re-triggering itself", () => {
    expect(parseImportRawKey("tenant/t1/imports/importjob-1/plan/page-0.jsonl")).toBeUndefined();
  });
});
