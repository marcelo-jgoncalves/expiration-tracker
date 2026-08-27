import { describe, expect, it } from "vitest";
import { startExtractionRun, DocumentNotCleanYetError } from "../../../src/modules/extraction/application/start-extraction-run.js";
import { documentKey, type Document } from "../../../src/modules/document/domain/document.js";
import { deriveExtractionRunId } from "../../../src/modules/extraction/domain/extraction-run.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";
import type { DocumentReader } from "../../../src/modules/extraction/ports/document-reader.js";
import type { ExtractionRunStore } from "../../../src/modules/extraction/ports/extraction-run-store.js";
import type { ExtractionExecutionInput, ExtractionExecutionStarter } from "../../../src/modules/extraction/ports/extraction-execution-starter.js";

function cleanDocument(overrides: Partial<Document> = {}): Document {
  return {
    ...documentKey("t1", "item1", "doc1"),
    entityType: "Document",
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    uploadSlotId: "slot1",
    fileName: "cert.pdf",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    status: "CLEAN",
    quarantineObject: { bucket: "q", key: "quarantine/t1/item1/doc1/slot1/x", versionId: "v0" },
    cleanObject: { bucket: "clean-bucket", key: "clean/t1/item1/doc1", versionId: "v1" },
    retentionClass: "USER_DOCUMENT",
    version: 3,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

class FakeDocumentReader implements DocumentReader {
  constructor(private readonly doc: Document | undefined) {}
  async get<T>(): Promise<T | undefined> {
    return this.doc as unknown as T | undefined;
  }
}

class FakeExtractionRunStore implements ExtractionRunStore {
  public readonly items = new Map<string, unknown>();
  async get(): Promise<undefined> {
    throw new Error("not used by startExtractionRun");
  }
  async putIfAbsent<T extends { PK: string; SK: string }>(item: T): Promise<boolean> {
    const key = `${item.PK}#${item.SK}`;
    if (this.items.has(key)) return false;
    this.items.set(key, item);
    return true;
  }
  async updateStatus(): Promise<boolean> {
    throw new Error("not used by startExtractionRun");
  }
}

class FakeExecutionStarter implements ExtractionExecutionStarter {
  public readonly calls: { name: string; input: ExtractionExecutionInput }[] = [];
  async startExecution(input: { name: string; input: ExtractionExecutionInput }): Promise<void> {
    this.calls.push(input);
  }
}

const CLEAN_OBJECT = { bucket: "clean-bucket", key: "clean/t1/item1/doc1", versionId: "v1" };

describe("startExtractionRun", () => {
  it("returns DOCUMENT_NOT_FOUND when the document doesn't exist", async () => {
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRun(
      { documents: new FakeDocumentReader(undefined), runs, executions },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", cleanObject: CLEAN_OBJECT },
    );
    expect(outcome).toBe("DOCUMENT_NOT_FOUND");
    expect(executions.calls).toHaveLength(0);
  });

  it("throws DocumentNotCleanYetError (retryable) when the document hasn't transitioned to CLEAN yet - real race with advanceAfterEvidence's promotion copy", async () => {
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    await expect(
      startExtractionRun(
        { documents: new FakeDocumentReader(cleanDocument({ status: "SCANNING" })), runs, executions },
        { tenantId: "t1", itemId: "item1", documentId: "doc1", cleanObject: CLEAN_OBJECT },
      ),
    ).rejects.toBeInstanceOf(DocumentNotCleanYetError);
    expect(executions.calls).toHaveLength(0);
  });

  it("creates the ExtractionRun and starts the execution on first invocation", async () => {
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRun(
      { documents: new FakeDocumentReader(cleanDocument()), runs, executions, now: () => "2026-08-26T00:00:00.000Z" },
      { tenantId: "t1", itemId: "item1", documentId: "doc1", cleanObject: CLEAN_OBJECT },
    );

    expect(outcome).toBe("STARTED");
    expect(executions.calls).toHaveLength(1);

    const expectedRunId = deriveExtractionRunId("t1", "doc1", 3, PIPELINE_VERSION_V1);
    expect(executions.calls[0]?.name).toBe(expectedRunId);
    expect(executions.calls[0]?.input).toEqual({
      tenantId: "t1",
      itemId: "item1",
      documentId: "doc1",
      documentVersion: 3,
      runId: expectedRunId,
      pipelineVersion: PIPELINE_VERSION_V1,
      cleanObject: CLEAN_OBJECT,
    });

    const stored = runs.items.get(`TENANT#t1#DOC#doc1#RUN#${expectedRunId}`) as { status: string } | undefined;
    expect(stored?.status).toBe("RUNNING");
  });

  it("is idempotent: a second invocation for the same document/version finds the run already there but still calls startExecution (AWS-side idempotency is the real dedup, see the port's doc comment)", async () => {
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const deps = { documents: new FakeDocumentReader(cleanDocument()), runs, executions };
    const input = { tenantId: "t1", itemId: "item1", documentId: "doc1", cleanObject: CLEAN_OBJECT };

    const first = await startExtractionRun(deps, input);
    const second = await startExtractionRun(deps, input);

    expect(first).toBe("STARTED");
    expect(second).toBe("ALREADY_RUNNING");
    expect(executions.calls).toHaveLength(2);
    expect(executions.calls[0]?.name).toBe(executions.calls[1]?.name);
  });

  it("never orphans a run when startExecution fails after the record was created - a retry still attempts startExecution again", async () => {
    const runs = new FakeExtractionRunStore();
    let attempt = 0;
    const flaky: ExtractionExecutionStarter = {
      async startExecution() {
        attempt += 1;
        if (attempt === 1) throw new Error("transient SFN throttling");
      },
    };
    const deps = { documents: new FakeDocumentReader(cleanDocument()), runs, executions: flaky };
    const input = { tenantId: "t1", itemId: "item1", documentId: "doc1", cleanObject: CLEAN_OBJECT };

    await expect(startExtractionRun(deps, input)).rejects.toThrow("transient SFN throttling");
    // Retry: the ExtractionRun record already exists (putIfAbsent -> false), but
    // startExecution must still be attempted - not skipped just because the record is there.
    const outcome = await startExtractionRun(deps, input);
    expect(outcome).toBe("ALREADY_RUNNING");
    expect(attempt).toBe(2);
  });

  it("derives a distinct run for a new document version - a re-uploaded/re-scanned document starts a fresh run", async () => {
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const deps = { documents: new FakeDocumentReader(cleanDocument({ version: 3 })), runs, executions };
    const input = { tenantId: "t1", itemId: "item1", documentId: "doc1", cleanObject: CLEAN_OBJECT };
    await startExtractionRun(deps, input);

    const deps2 = { documents: new FakeDocumentReader(cleanDocument({ version: 4 })), runs, executions };
    const outcome = await startExtractionRun(deps2, input);

    expect(outcome).toBe("STARTED");
    expect(executions.calls).toHaveLength(2);
    expect(executions.calls[0]?.name).not.toBe(executions.calls[1]?.name);
  });
});
