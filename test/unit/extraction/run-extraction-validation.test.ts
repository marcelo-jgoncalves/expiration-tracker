import { describe, expect, it } from "vitest";
import {
  validateSchema,
  compareExtractorsStage,
  persistExtractedFieldsStage,
  markPendingConfirmationStage,
  completeRunStage,
  runExtractionValidation,
  type RunExtractionValidationDeps,
  type ValidationContext,
} from "../../../src/modules/extraction/application/run-extraction-validation.js";
import type { DocumentReader } from "../../../src/modules/extraction/ports/document-reader.js";
import type { ExtractionRunStore } from "../../../src/modules/extraction/ports/extraction-run-store.js";
import type { CommitRunOutcomeInput, CommitRunOutcomeResult, ExtractedFieldStore } from "../../../src/modules/extraction/ports/extracted-field-store.js";
import type { ExtractionArtifactRef, OcrArtifactStore } from "../../../src/modules/extraction/ports/ocr-artifact-store.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";
import { ExtractionCommitFailedError } from "../../../src/shared/errors/app-error.js";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    ...documentKey("t1", "item1", "doc1"),
    entityType: "Document",
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    uploadSlotId: "slot1",
    fileName: "f.pdf",
    mediaType: "application/pdf",
    contentLength: 10,
    checksumSha256: "abc",
    status: "CLEAN",
    quarantineObject: { bucket: "q", key: "k", versionId: "v1" },
    retentionClass: "USER_DOCUMENT",
    version: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class FakeDocumentReader implements DocumentReader {
  constructor(private readonly doc: Document | undefined) {}
  async get<T extends EntityKey>(): Promise<T | undefined> {
    return this.doc as unknown as T | undefined;
  }
}

class FakeExtractionRunStore implements ExtractionRunStore {
  public updateStatusCalls: unknown[] = [];
  async putIfAbsent(): Promise<boolean> {
    throw new Error("not used");
  }
  async updateStatus(key: EntityKey, tenantId: string, expectedVersion: number, status: "DISCARDED", completedAt: string): Promise<boolean> {
    this.updateStatusCalls.push({ key, tenantId, expectedVersion, status, completedAt });
    return true;
  }
}

class FakeExtractedFieldStore implements ExtractedFieldStore {
  public commitCalls: CommitRunOutcomeInput[] = [];
  constructor(private readonly result: CommitRunOutcomeResult | Error = "COMMITTED") {}
  async commitRunOutcome(input: CommitRunOutcomeInput): Promise<CommitRunOutcomeResult> {
    this.commitCalls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

class FakeOcrArtifactStore implements OcrArtifactStore {
  public deleteCalls: ExtractionArtifactRef[] = [];
  async put(): Promise<ExtractionArtifactRef> {
    throw new Error("not used");
  }
  async get(): Promise<string> {
    throw new Error("not used");
  }
  async delete(ref: ExtractionArtifactRef): Promise<void> {
    this.deleteCalls.push(ref);
  }
}

function baseContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    documentVersion: 3,
    runId: "run1",
    pipelineVersion: PIPELINE_VERSION_V1,
    ocrAvailable: true,
    extractedFields: [{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.9, source: "DETERMINISTIC_PARSER" }],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<{ doc: Document | undefined; commitResult: CommitRunOutcomeResult | Error }> = {}) {
  const documents = new FakeDocumentReader(overrides.doc ?? makeDocument());
  const runs = new FakeExtractionRunStore();
  const fields = new FakeExtractedFieldStore(overrides.commitResult ?? "COMMITTED");
  const artifacts = new FakeOcrArtifactStore();
  const deps: RunExtractionValidationDeps = { documents, runs, fields, artifacts, now: () => "2026-08-26T00:00:00.000Z" };
  return { deps, documents, runs, fields, artifacts };
}

describe("validateSchema (VALIDATE_SCHEMA)", () => {
  it("marks a schema-valid candidate valid and an invalid one invalid, for both extractors", () => {
    const out = validateSchema(
      baseContext({
        extractedFields: [{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "not-a-date", confidence: 0.9, source: "DETERMINISTIC_PARSER" }],
        bedrockFields: [{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.8, source: "BEDROCK" }],
      }),
    );
    expect(out.extractedFields?.[0]?.valid).toBe(false);
    expect(out.bedrockFields?.[0]?.valid).toBe(true);
  });

  it("marks a field with no candidateValue as invalid, never throwing", () => {
    const out = validateSchema(baseContext({ extractedFields: [{ fieldName: "expirationDate", valueType: "DATE", source: "DETERMINISTIC_PARSER" }] }));
    expect(out.extractedFields?.[0]?.valid).toBe(false);
  });
});

describe("compareExtractorsStage (COMPARE_EXTRACTORS)", () => {
  it("produces one comparedFields entry per schema field, using only validated candidates", () => {
    const out = compareExtractorsStage(
      baseContext({
        extractedFields: [{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.9, source: "DETERMINISTIC_PARSER", valid: true }],
        bedrockFields: [{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.95, source: "BEDROCK", valid: true }],
      }),
    );
    expect(out.comparedFields).toEqual([
      { fieldName: "expirationDate", valueType: "DATE", agreement: "MATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.95 },
    ]);
  });

  it("ignores an invalid candidate entirely (as if that source produced nothing)", () => {
    const out = compareExtractorsStage(
      baseContext({
        extractedFields: [{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "garbage", confidence: 0.9, source: "DETERMINISTIC_PARSER", valid: false }],
      }),
    );
    expect(out.comparedFields).toEqual([{ fieldName: "expirationDate", valueType: "DATE", agreement: "SINGLE_SOURCE", sources: [], candidateValue: undefined, confidence: undefined }]);
  });
});

describe("persistExtractedFieldsStage (PERSIST_EXTRACTED_FIELDS)", () => {
  const compared = baseContext({
    comparedFields: [{ fieldName: "expirationDate", valueType: "DATE", agreement: "MATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.95 }],
  });

  it("commits a CONFIRMED field and marks the run COMPLETED, never touching the artifact", async () => {
    const { deps, fields, artifacts } = makeDeps();
    const out = await persistExtractedFieldsStage(deps, { ...compared, artifact: { bucket: "b", key: "k" } });
    expect(out.runOutcome).toBe("COMPLETED");
    expect(out.requiresReview).toBe(false);
    expect(fields.commitCalls).toHaveLength(1);
    expect(fields.commitCalls[0]?.fields[0]?.state).toBe("CONFIRMED");
    expect(fields.commitCalls[0]?.fields[0]?.confirmedValue).toBe("2027-03-31");
    expect(fields.commitCalls[0]?.runStatus).toBe("COMPLETED");
    expect(artifacts.deleteCalls).toHaveLength(0); // <-- governing invariant (design §3)
  });

  it("marks requiresReview when at least one field ends PENDING_CONFIRMATION", async () => {
    const { deps } = makeDeps();
    const mismatched = baseContext({
      comparedFields: [{ fieldName: "expirationDate", valueType: "DATE", agreement: "MISMATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.9 }],
    });
    const out = await persistExtractedFieldsStage(deps, mismatched);
    expect(out.runOutcome).toBe("COMPLETED");
    expect(out.requiresReview).toBe(true);
  });

  it("short-circuits to DISCARDED without ever building/committing fields when the Document is already DELETED", async () => {
    const { deps, fields, runs } = makeDeps({ doc: makeDocument({ status: "DELETED" }) });
    const out = await persistExtractedFieldsStage(deps, compared);
    expect(out.runOutcome).toBe("DISCARDED");
    expect(fields.commitCalls).toHaveLength(0);
    expect(runs.updateStatusCalls).toHaveLength(1);
  });

  it("falls back to DISCARDED when commitRunOutcome reports a concurrent Document change (TOCTOU close)", async () => {
    const { deps, runs } = makeDeps({ commitResult: "DOCUMENT_DISCARDED" });
    const out = await persistExtractedFieldsStage(deps, compared);
    expect(out.runOutcome).toBe("DISCARDED");
    expect(runs.updateStatusCalls).toHaveLength(1);
  });

  it("wraps a genuine commit failure in ExtractionCommitFailedError, never swallowing it as a discard", async () => {
    const { deps } = makeDeps({ commitResult: new Error("DynamoDB is down") });
    await expect(persistExtractedFieldsStage(deps, compared)).rejects.toBeInstanceOf(ExtractionCommitFailedError);
  });
});

describe("markPendingConfirmationStage (MARK_PENDING_CONFIRMATION) - parser hard-failure branch", () => {
  it("persists every schema field as PENDING_CONFIRMATION with no candidate, marks the run FAILED, and deletes the artifact if one exists", async () => {
    const { deps, fields, artifacts } = makeDeps();
    const out = await markPendingConfirmationStage(deps, baseContext({ artifact: { bucket: "b", key: "k" }, parserFailure: { error: "DeterministicParserFailed" } }));
    expect(out.runOutcome).toBe("FAILED");
    expect(fields.commitCalls[0]?.fields[0]?.state).toBe("PENDING_CONFIRMATION");
    expect(fields.commitCalls[0]?.fields[0]?.candidateValue).toBeUndefined();
    expect(fields.commitCalls[0]?.runStatus).toBe("FAILED");
    expect(artifacts.deleteCalls).toEqual([{ bucket: "b", key: "k" }]); // <-- deletion point #2 (design §3)
  });

  it("never calls delete() when no artifact was ever produced (RunTextract failed before the parser even ran)", async () => {
    const { deps, artifacts } = makeDeps();
    await markPendingConfirmationStage(deps, baseContext({ artifact: undefined }));
    expect(artifacts.deleteCalls).toHaveLength(0);
  });

  it("still discards (never persists fields) when the Document was concurrently deleted, but still deletes the artifact", async () => {
    const { deps, fields, runs, artifacts } = makeDeps({ doc: makeDocument({ status: "DELETED" }) });
    const out = await markPendingConfirmationStage(deps, baseContext({ artifact: { bucket: "b", key: "k" } }));
    expect(out.runOutcome).toBe("DISCARDED");
    expect(fields.commitCalls).toHaveLength(0);
    expect(runs.updateStatusCalls).toHaveLength(1);
    expect(artifacts.deleteCalls).toEqual([{ bucket: "b", key: "k" }]);
  });
});

describe("completeRunStage (COMPLETE_RUN) - normal-path terminal state", () => {
  it("deletes the artifact exactly once when one exists", async () => {
    const { deps, artifacts } = makeDeps();
    const out = await completeRunStage(deps, baseContext({ artifact: { bucket: "b", key: "k" }, runOutcome: "COMPLETED" }));
    expect(artifacts.deleteCalls).toEqual([{ bucket: "b", key: "k" }]);
    expect(out.runOutcome).toBe("COMPLETED");
  });

  it("is idempotent/safe when no artifact exists (OCR was disabled or never ran)", async () => {
    const { deps, artifacts } = makeDeps();
    await completeRunStage(deps, baseContext({ artifact: undefined }));
    expect(artifacts.deleteCalls).toHaveLength(0);
  });
});

describe("governing invariant (design §3): the artifact is deleted in exactly one of the five operations per execution, never earlier", () => {
  it("across the full happy-path sequence (VALIDATE_SCHEMA -> COMPARE_EXTRACTORS -> PERSIST_EXTRACTED_FIELDS -> COMPLETE_RUN), delete() is called exactly once, only at CompleteRun", async () => {
    const { deps, artifacts } = makeDeps();
    let ctx = baseContext({ artifact: { bucket: "b", key: "k" } });

    ctx = await runExtractionValidation(deps, "VALIDATE_SCHEMA", ctx);
    expect(artifacts.deleteCalls).toHaveLength(0); // still might retry - must not have deleted
    ctx = await runExtractionValidation(deps, "COMPARE_EXTRACTORS", ctx);
    expect(artifacts.deleteCalls).toHaveLength(0);
    ctx = await runExtractionValidation(deps, "PERSIST_EXTRACTED_FIELDS", ctx);
    expect(artifacts.deleteCalls).toHaveLength(0); // committed to DB, but artifact still intact
    await runExtractionValidation(deps, "COMPLETE_RUN", ctx);
    expect(artifacts.deleteCalls).toHaveLength(1); // deleted only now, at the true terminal step
  });

  it("across the parser-hard-failure sequence, delete() is called exactly once, only at MarkPendingConfirmation", async () => {
    const { deps, artifacts } = makeDeps();
    const ctx = baseContext({ artifact: { bucket: "b", key: "k" }, extractedFields: undefined, parserFailure: { error: "DeterministicParserFailed" } });
    await runExtractionValidation(deps, "MARK_PENDING_CONFIRMATION", ctx as ValidationContext);
    expect(artifacts.deleteCalls).toHaveLength(1);
  });
});
