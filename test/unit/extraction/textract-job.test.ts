import { describe, expect, it } from "vitest";
import {
  computeTextractJobTtl,
  deriveTextractClientRequestToken,
  textractJobKey,
  TEXTRACT_JOB_TTL_SECONDS,
} from "../../../src/modules/extraction/domain/textract-job.js";

describe("textractJobKey", () => {
  it("keys the record by jobId alone (no tenant scoping - COMPLETE_OCR has no tenant context yet)", () => {
    expect(textractJobKey("job_abc")).toEqual({ PK: "TEXTRACTJOB#job_abc", SK: "TEXTRACTJOB#job_abc" });
  });
});

describe("deriveTextractClientRequestToken", () => {
  it("is deterministic for the same inputs", () => {
    const a = deriveTextractClientRequestToken("t1", "doc1", 3, "2026-08-01", "run_x");
    const b = deriveTextractClientRequestToken("t1", "doc1", 3, "2026-08-01", "run_x");
    expect(a).toBe(b);
  });

  it("differs when any single input changes", () => {
    const base = deriveTextractClientRequestToken("t1", "doc1", 3, "2026-08-01", "run_x");
    expect(deriveTextractClientRequestToken("t2", "doc1", 3, "2026-08-01", "run_x")).not.toBe(base);
    expect(deriveTextractClientRequestToken("t1", "doc2", 3, "2026-08-01", "run_x")).not.toBe(base);
    expect(deriveTextractClientRequestToken("t1", "doc1", 4, "2026-08-01", "run_x")).not.toBe(base);
    expect(deriveTextractClientRequestToken("t1", "doc1", 3, "2026-09-01", "run_x")).not.toBe(base);
    expect(deriveTextractClientRequestToken("t1", "doc1", 3, "2026-08-01", "run_y")).not.toBe(base);
  });
});

describe("computeTextractJobTtl", () => {
  it("adds the fixed short TTL window in epoch seconds", () => {
    const nowIso = "2026-08-26T00:00:00.000Z";
    const expected = Math.floor(Date.parse(nowIso) / 1000) + TEXTRACT_JOB_TTL_SECONDS;
    expect(computeTextractJobTtl(nowIso)).toBe(expected);
  });
});
