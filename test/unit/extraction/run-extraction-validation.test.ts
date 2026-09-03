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
import type { EntityReader } from "../../../src/modules/extraction/ports/entity-reader.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import { documentKey as documentArchiveKey, type Document as ArchiveDocument } from "../../../src/modules/document-archive/domain/document.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { gsi1Keys, itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";
import { ExtractionCommitFailedError } from "../../../src/shared/errors/app-error.js";
import { SYSTEM_AUTO_CONFIRM_ACTOR } from "../../../src/modules/extraction/application/confirm-reject-field-document-archive.js";

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

function makeDocumentVersion(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    ...documentVersionKey("t1", "doc1", 3),
    entityType: "DocumentVersion",
    versionId: "v1",
    documentId: "doc1",
    tenantId: "t1",
    seq: 3,
    state: "RECEIVED",
    origin: "MANUAL_UPLOAD",
    pendingFileScans: 0,
    infectedFileScans: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 4,
    ...overrides,
  };
}

class FakeDocumentReader implements DocumentReader {
  public getCalls: EntityKey[] = [];
  // D-193 item 4/9: `documentVersion`, when supplied, is returned for any key whose SK starts
  // with `VERSION#` (`documentVersionKey()`'s own SK shape) - `doc` is returned for every other
  // key, same single-fixture-per-role convention this fake already used before this addition.
  constructor(
    private readonly doc: Document | ArchiveDocument | undefined,
    private readonly documentVersion?: DocumentVersion,
  ) {}
  async get<T extends EntityKey>(key: EntityKey): Promise<T | undefined> {
    this.getCalls.push(key);
    if (this.documentVersion && typeof key.SK === "string" && key.SK.startsWith("VERSION#")) {
      return this.documentVersion as unknown as T | undefined;
    }
    return this.doc as unknown as T | undefined;
  }
}

/** D-193 item 3/9 slice 3: the `document-archive` counterpart of `makeDocument()` above — a
 * distinct entity (`Document.status` is ACTIVE/ARCHIVED, never DELETED, and there is no
 * `itemId`), read through the SAME `FakeDocumentReader`/`DocumentReader.get()` (structural,
 * single-table reuse), never a second port. */
function makeArchiveDocument(overrides: Partial<ArchiveDocument> = {}): ArchiveDocument {
  return {
    ...documentArchiveKey("t1", "doc1"),
    entityType: "Document",
    documentId: "doc1",
    tenantId: "t1",
    subjectId: "subject1",
    documentTypeId: "doctype1",
    status: "ACTIVE",
    hasValidity: true,
    version: 5,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    GSI1PK: "x",
    GSI1SK: "y",
    GSI2PK: "x",
    GSI2SK: "y",
    ...overrides,
  };
}

function makeItem(overrides: Partial<ExpirationItem> = {}): ExpirationItem {
  return {
    ...itemKey("t1", "item1"),
    SK: "META",
    entityType: "ExpirationItem",
    itemId: "item1",
    tenantId: "t1",
    name: "Alvará",
    category: "licenca",
    categoryNormalized: "licenca",
    dueDate: "2030-01-01",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 7,
    ...gsi1Keys("t1", "ACTIVE", "2030-01-01", "item1"),
    ...overrides,
  };
}

class FakeItemReader implements EntityReader {
  public getCalls: Array<{ key: EntityKey; consistentRead?: boolean }> = [];
  constructor(private readonly item: ExpirationItem | undefined) {}
  async get<T extends EntityKey>(key: EntityKey, consistentRead?: boolean): Promise<T | undefined> {
    this.getCalls.push({ key, consistentRead });
    return this.item as unknown as T | undefined;
  }
}

class FakeExtractionRunStore implements ExtractionRunStore {
  public updateStatusCalls: unknown[] = [];
  async get(): Promise<undefined> {
    throw new Error("not used");
  }
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
  async get(): Promise<undefined> {
    throw new Error("not used");
  }
  async confirmField(): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    throw new Error("not used");
  }
  async rejectField(): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    throw new Error("not used");
  }
  async confirmFieldForDocumentArchive(): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    throw new Error("not used");
  }
  async rejectFieldForDocumentArchive(): Promise<"COMMITTED" | "VERSION_CONFLICT"> {
    throw new Error("not used");
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
    correlationId: "corr-1",
    ocrAvailable: true,
    extractedFields: [{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.9, source: "DETERMINISTIC_PARSER" }],
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<{
    doc: Document | ArchiveDocument | undefined;
    item: ExpirationItem | undefined;
    documentVersion: DocumentVersion | undefined;
    commitResult: CommitRunOutcomeResult | Error;
  }> = {},
) {
  const documents = new FakeDocumentReader("doc" in overrides ? overrides.doc : makeDocument(), "documentVersion" in overrides ? overrides.documentVersion : undefined);
  const items = new FakeItemReader("item" in overrides ? overrides.item : makeItem());
  const runs = new FakeExtractionRunStore();
  const fields = new FakeExtractedFieldStore(overrides.commitResult ?? "COMMITTED");
  const artifacts = new FakeOcrArtifactStore();
  const deps: RunExtractionValidationDeps = { documents, items, runs, fields, artifacts, now: () => "2026-08-26T00:00:00.000Z" };
  return { deps, documents, items, runs, fields, artifacts };
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
    // Logging-observability-standard.md "Tracing distribuído" (2026-08-29).
    expect(out.correlationId).toBe("corr-1");
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

  // W2-01-DECISION: an auto-CONFIRMED field must reach the same outcome as a human confirm.
  describe("auto-confirm writes ExpirationItem.dueDate (W2-01-DECISION)", () => {
    it("includes an OCC-guarded ExpirationItem update, with GSI1 re-keyed, in the SAME commit transaction", async () => {
      const { deps, fields, items } = makeDeps();
      const out = await persistExtractedFieldsStage(deps, compared);

      expect(out.runOutcome).toBe("COMPLETED");
      expect(items.getCalls).toEqual([{ key: itemKey("t1", "item1"), consistentRead: true }]);
      expect(fields.commitCalls).toHaveLength(1); // one transaction, not a follow-up write
      expect(fields.commitCalls[0]?.itemUpdate).toEqual({
        key: itemKey("t1", "item1"),
        tenantId: "t1",
        expectedVersion: 7, // the version just read - OCC guard, same as the manual confirm path
        set: {
          dueDate: "2027-03-31",
          ...gsi1Keys("t1", "ACTIVE", "2027-03-31", "item1"),
        },
      });
    });

    it("never touches the item when the field stayed PENDING_CONFIRMATION (a human still decides)", async () => {
      const { deps, fields, items } = makeDeps();
      const mismatched = baseContext({
        comparedFields: [{ fieldName: "expirationDate", valueType: "DATE", agreement: "MISMATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.9 }],
      });
      await persistExtractedFieldsStage(deps, mismatched);
      expect(items.getCalls).toHaveLength(0);
      expect(fields.commitCalls[0]?.itemUpdate).toBeUndefined();
    });

    it("still commits the fields, with no item update, when the ExpirationItem is gone or DELETED", async () => {
      for (const item of [undefined, makeItem({ status: "DELETED" })]) {
        const { deps, fields } = makeDeps({ item });
        const out = await persistExtractedFieldsStage(deps, compared);
        expect(out.runOutcome).toBe("COMPLETED");
        expect(fields.commitCalls[0]?.itemUpdate).toBeUndefined();
      }
    });

    it("is retry-safe: a re-run of an already-committed stage cancels the whole transaction (item write included) and discards", async () => {
      // The real adapter reports an already-existing ExtractedField row (attribute_not_exists
      // Put) as DOCUMENT_DISCARDED - the item Update rides in the same all-or-nothing
      // TransactWriteItems, so the dueDate write can never be applied a second time.
      const { deps, runs } = makeDeps({ commitResult: "DOCUMENT_DISCARDED" });
      const out = await persistExtractedFieldsStage(deps, compared);
      expect(out.runOutcome).toBe("DISCARDED");
      expect(runs.updateStatusCalls).toHaveLength(1);
    });

    it("markPendingConfirmationStage never builds an item update (no field is ever auto-confirmed there)", async () => {
      const { deps, fields, items } = makeDeps();
      await markPendingConfirmationStage(deps, baseContext());
      expect(items.getCalls).toHaveLength(0);
      expect(fields.commitCalls[0]?.itemUpdate).toBeUndefined();
    });
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

// -------------------------------------------------------------------------------------------
// D-193 item 3/9 slice 3: commitOrDiscard()'s NEW `documentSource: "DOCUMENT_ARCHIVE"` branch —
// guards against the `document-archive` `Document` row (by `documentId` alone) instead of the
// OLD `document`-module `Document` (by `itemId`), and never builds the OLD path's auto-confirm
// `ExpirationItem` update (item 4/9 of the design, explicitly deferred).
// -------------------------------------------------------------------------------------------
describe("commitOrDiscard — document-archive source (D-193 item 3/9 slice 3)", () => {
  const archiveCompared = baseContext({
    documentSource: "DOCUMENT_ARCHIVE",
    comparedFields: [{ fieldName: "expirationDate", valueType: "DATE", agreement: "MATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.95 }],
  });

  it("commits against the document-archive Document (never the OLD module's Document-by-itemId), with no ExpirationItem update, and plans+applies the DocumentVersion.validUntil effect (D-193 item 4/9)", async () => {
    const version = makeDocumentVersion({ validUntil: undefined });
    const { deps, fields, documents, items } = makeDeps({ doc: makeArchiveDocument(), documentVersion: version });
    const out = await persistExtractedFieldsStage(deps, archiveCompared);

    expect(out.runOutcome).toBe("COMPLETED");
    expect(fields.commitCalls).toHaveLength(1);
    expect(fields.commitCalls[0]?.documentKey).toEqual(documentArchiveKey("t1", "doc1"));
    expect(fields.commitCalls[0]?.documentExpectedVersion).toBe(5);
    expect(fields.commitCalls[0]?.itemUpdate).toBeUndefined();
    // The OLD path's per-item-attribute lookup never runs for a document-archive-sourced run.
    expect(items.getCalls).toHaveLength(0);
    expect(documents.getCalls).toEqual([documentVersionKey("t1", "doc1", 3), documentArchiveKey("t1", "doc1")]);
    expect(fields.commitCalls[0]?.documentVersionUpdate).toEqual({
      key: documentVersionKey("t1", "doc1", 3),
      tenantId: "t1",
      expectedVersion: 4,
      effect: { kind: "SET", validUntil: "2027-03-31" },
      documentId: "doc1",
      versionId: "v1",
      correlationId: "corr-1",
    });
    // Provenance (checklist criterion 6) — set on the same ExtractedField row, same transaction.
    expect(fields.commitCalls[0]?.fields[0]?.confirmedBy).toBe(SYSTEM_AUTO_CONFIRM_ACTOR);
    expect(fields.commitCalls[0]?.fields[0]?.confirmedAt).toBe("2026-08-26T00:00:00.000Z");
  });

  it("plans NO_CHANGE (no outbox-triggering effect) when the confirmed value is byte-identical to the DocumentVersion's current validUntil", async () => {
    const version = makeDocumentVersion({ validUntil: "2027-03-31" });
    const { deps, fields } = makeDeps({ doc: makeArchiveDocument(), documentVersion: version });
    await persistExtractedFieldsStage(deps, archiveCompared);
    expect(fields.commitCalls[0]?.documentVersionUpdate?.effect).toEqual({ kind: "NO_CHANGE" });
  });

  it("plans NO_CHANGE when the DocumentVersion is in an ineligible state (e.g. SUPERSEDED)", async () => {
    const version = makeDocumentVersion({ state: "SUPERSEDED", validUntil: undefined });
    const { deps, fields } = makeDeps({ doc: makeArchiveDocument(), documentVersion: version });
    await persistExtractedFieldsStage(deps, archiveCompared);
    expect(fields.commitCalls[0]?.documentVersionUpdate?.effect).toEqual({ kind: "NO_CHANGE" });
  });

  it("discards when the document-archive Document row is missing", async () => {
    const { deps, fields, runs } = makeDeps({ doc: undefined });
    const out = await persistExtractedFieldsStage(deps, archiveCompared);
    expect(out.runOutcome).toBe("DISCARDED");
    expect(fields.commitCalls).toHaveLength(0);
    expect(runs.updateStatusCalls).toHaveLength(1);
  });

  it("does NOT discard for an ARCHIVED document-archive Document - archiving is a soft-hide (document-archive/domain/document.ts's own invariant), never equivalent to the OLD path's hard DELETED", async () => {
    const { deps, fields } = makeDeps({ doc: makeArchiveDocument({ status: "ARCHIVED" }) });
    const out = await persistExtractedFieldsStage(deps, archiveCompared);
    expect(out.runOutcome).toBe("COMPLETED");
    expect(fields.commitCalls).toHaveLength(1);
  });

  it("falls back to DISCARDED when commitRunOutcome reports a concurrent document-archive Document change (same TOCTOU close as the OLD path)", async () => {
    const { deps, runs } = makeDeps({ doc: makeArchiveDocument(), commitResult: "DOCUMENT_DISCARDED" });
    const out = await persistExtractedFieldsStage(deps, archiveCompared);
    expect(out.runOutcome).toBe("DISCARDED");
    expect(runs.updateStatusCalls).toHaveLength(1);
  });

  it("markPendingConfirmationStage also branches to the document-archive guard, still deleting the artifact", async () => {
    const { deps, fields, artifacts } = makeDeps({ doc: makeArchiveDocument() });
    const out = await markPendingConfirmationStage(deps, { ...archiveCompared, artifact: { bucket: "b", key: "k" } });
    expect(out.runOutcome).toBe("FAILED");
    expect(fields.commitCalls[0]?.documentKey).toEqual(documentArchiveKey("t1", "doc1"));
    expect(artifacts.deleteCalls).toEqual([{ bucket: "b", key: "k" }]);
  });

  it("an execution started before this slice (documentSource undefined) keeps resolving to the OLD path unchanged (regression)", async () => {
    const { deps, fields, documents } = makeDeps({ doc: makeDocument() });
    const compared = baseContext({
      comparedFields: [{ fieldName: "expirationDate", valueType: "DATE", agreement: "MATCH", sources: ["DETERMINISTIC_PARSER", "BEDROCK"], candidateValue: "2027-03-31", confidence: 0.95 }],
    });
    const out = await persistExtractedFieldsStage(deps, compared);
    expect(out.runOutcome).toBe("COMPLETED");
    expect(fields.commitCalls[0]?.documentKey).toEqual(documentKey("t1", "item1", "doc1"));
    expect(documents.getCalls).toEqual([documentKey("t1", "item1", "doc1")]);
  });
});
