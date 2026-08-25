import { describe, expect, it } from "vitest";
import { deriveExtractionRunId, extractionRunKey } from "../../../src/modules/extraction/domain/extraction-run.js";

describe("deriveExtractionRunId", () => {
  it("is deterministic for the same idempotency key", () => {
    const a = deriveExtractionRunId("tenant-1", "doc-1", 3, "2026-08-01");
    const b = deriveExtractionRunId("tenant-1", "doc-1", 3, "2026-08-01");
    expect(a).toBe(b);
  });

  it("differs when documentVersion changes - a new version starts a new run, never reuses the old id", () => {
    const v3 = deriveExtractionRunId("tenant-1", "doc-1", 3, "2026-08-01");
    const v4 = deriveExtractionRunId("tenant-1", "doc-1", 4, "2026-08-01");
    expect(v3).not.toBe(v4);
  });

  it("differs when pipelineVersion changes - reprocessing under a new pipeline is a new run", () => {
    const p1 = deriveExtractionRunId("tenant-1", "doc-1", 3, "2026-08-01");
    const p2 = deriveExtractionRunId("tenant-1", "doc-1", 3, "2026-09-01");
    expect(p1).not.toBe(p2);
  });

  it("differs across tenants for otherwise identical documentId/version/pipeline", () => {
    const t1 = deriveExtractionRunId("tenant-1", "doc-1", 3, "2026-08-01");
    const t2 = deriveExtractionRunId("tenant-2", "doc-1", 3, "2026-08-01");
    expect(t1).not.toBe(t2);
  });
});

describe("extractionRunKey", () => {
  it("matches data-model.md's PK/SK pattern (TENANT#t#DOC#d / RUN#<runId>)", () => {
    expect(extractionRunKey("tenant-1", "doc-1", "run-abc")).toEqual({ PK: "TENANT#tenant-1#DOC#doc-1", SK: "RUN#run-abc" });
  });
});
