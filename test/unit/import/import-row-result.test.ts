/**
 * D-292 (A15 drill-down gap, D-269/D-271) — pure merge of plan NDJSON + ImportRowOutcome rows,
 * no I/O.
 */
import { describe, expect, it } from "vitest";
import { mergeImportRowResults } from "../../../src/modules/import/domain/import-row-result.js";
import type { ImportRowOutcome } from "../../../src/modules/import/domain/import-row-outcome.js";

function outcome(overrides: Partial<ImportRowOutcome> = {}): ImportRowOutcome {
  return {
    PK: "TENANT#t1#IMPORTJOB#job-1",
    SK: `ROWOUTCOME#${String(overrides.rowNumber ?? 1).padStart(6, "0")}`,
    entityType: "ImportRowOutcome",
    tenantId: "t1",
    jobId: "job-1",
    rowNumber: 1,
    outcome: "COMMITTED",
    createdAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeImportRowResults", () => {
  it("REJECT plan entries never look at outcomes - always REJECTED with the plan's own reason/field", () => {
    const plan = [{ rowNumber: 1, action: "REJECT", reason: "MISSING_DISPLAY_NAME", field: "displayName" }].map((e) => JSON.stringify(e)).join("\n");
    const result = mergeImportRowResults(plan, []);
    expect(result).toEqual([{ rowNumber: 1, status: "REJECTED", reason: "MISSING_DISPLAY_NAME", field: "displayName" }]);
  });

  it("SKIP_DUPLICATE plan entries never look at outcomes - always SKIPPED with the plan's own reason, never a field", () => {
    const plan = [{ rowNumber: 2, action: "SKIP_DUPLICATE", reason: "EXTERNAL_ID_ALREADY_EXISTS", externalId: "ext-1", displayName: "ACME" }]
      .map((e) => JSON.stringify(e))
      .join("\n");
    const result = mergeImportRowResults(plan, []);
    expect(result).toEqual([{ rowNumber: 2, status: "SKIPPED", reason: "EXTERNAL_ID_ALREADY_EXISTS" }]);
  });

  it("CREATE_SUBJECT with a matching COMMITTED outcome returns COMMITTED + entityId, never REJECTED/SKIPPED", () => {
    const plan = [{ rowNumber: 3, action: "CREATE_SUBJECT", row: { rowNumber: 3 } }].map((e) => JSON.stringify(e)).join("\n");
    const result = mergeImportRowResults(plan, [outcome({ rowNumber: 3, outcome: "COMMITTED", entityId: "subject-99" })]);
    expect(result).toEqual([{ rowNumber: 3, status: "COMMITTED", entityId: "subject-99" }]);
  });

  it("CREATE_DOCUMENT with a matching FAILED outcome returns FAILED + the outcome's own failureReason", () => {
    const plan = [{ rowNumber: 4, action: "CREATE_DOCUMENT", row: { rowNumber: 4 }, subjectId: "s1", documentTypeId: "dt1" }].map((e) => JSON.stringify(e)).join("\n");
    const result = mergeImportRowResults(plan, [outcome({ rowNumber: 4, outcome: "FAILED", failureReason: "SUBJECT_REFERENCE_NOT_FOUND", entityId: undefined })]);
    expect(result).toEqual([{ rowNumber: 4, status: "FAILED", reason: "SUBJECT_REFERENCE_NOT_FOUND" }]);
  });

  it("CREATE_REQUIREMENT with NO matching outcome yet is PENDING, never silently omitted - a partially-committed job (cursor-based resume) must show rows not yet reached", () => {
    const plan = [{ rowNumber: 5, action: "CREATE_REQUIREMENT", row: { rowNumber: 5 }, subjectId: "s1" }].map((e) => JSON.stringify(e)).join("\n");
    const result = mergeImportRowResults(plan, []);
    expect(result).toEqual([{ rowNumber: 5, status: "PENDING" }]);
  });

  it("a full mixed plan (reject/skip/committed/failed/pending) is returned sorted by rowNumber, one entry per plan line", () => {
    const plan = [
      { rowNumber: 3, action: "CREATE_SUBJECT", row: { rowNumber: 3 } },
      { rowNumber: 1, action: "REJECT", reason: "MISSING_TYPE", field: "type" },
      { rowNumber: 2, action: "SKIP_DUPLICATE", reason: "DISPLAY_NAME_ALREADY_EXISTS", displayName: "ACME" },
      { rowNumber: 4, action: "CREATE_SUBJECT", row: { rowNumber: 4 } },
      { rowNumber: 5, action: "CREATE_SUBJECT", row: { rowNumber: 5 } },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");
    const outcomes = [outcome({ rowNumber: 3, outcome: "COMMITTED", entityId: "subj-3" }), outcome({ rowNumber: 4, outcome: "FAILED", failureReason: "DUPLICATE_EXTERNAL_ID_IN_FILE" })];
    const result = mergeImportRowResults(plan, outcomes);
    expect(result.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(result.map((r) => r.status)).toEqual(["REJECTED", "SKIPPED", "COMMITTED", "FAILED", "PENDING"]);
  });

  it("an empty plan returns an empty array, never throws", () => {
    expect(mergeImportRowResults("", [])).toEqual([]);
  });
});
