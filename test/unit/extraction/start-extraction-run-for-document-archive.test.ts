import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "../document-archive/in-memory-store.js";
import { startExtractionRunForDocumentArchive } from "../../../src/modules/extraction/application/start-extraction-run-for-document-archive.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { extractionRunKey, deriveExtractionRunId } from "../../../src/modules/extraction/domain/extraction-run.js";
import { PIPELINE_VERSION_V1 } from "../../../src/modules/extraction/domain/field-schema.js";
import type { ExtractionRunStore } from "../../../src/modules/extraction/ports/extraction-run-store.js";
import type { ExtractionExecutionInput, ExtractionExecutionStarter } from "../../../src/modules/extraction/ports/extraction-execution-starter.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "t1";
const DOC = "doc1";
const SEQ = 1;
const FILE = "file1";
const VERSION_ID = "v-1";
const CLEAN_OBJECT = { bucket: "clean-bucket", key: "document-archive/clean/t1/doc1/v-1/file1", versionId: "clean-v1" };

function baseFile(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    ...documentFileKey(TENANT, DOC, SEQ, FILE),
    entityType: "DocumentFile",
    tenantId: TENANT,
    documentId: DOC,
    versionId: VERSION_ID,
    seq: SEQ,
    fileId: FILE,
    role: "PRINCIPAL",
    scanStatus: "CLEAN",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    quarantineObject: { bucket: "q", key: "document-archive/tenant/t1/document/doc1/version/1/file/file1", versionId: "real-v1" },
    cleanObject: CLEAN_OBJECT,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    version: 2,
    ...overrides,
  };
}

function baseVersion(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    ...documentVersionKey(TENANT, DOC, SEQ),
    entityType: "DocumentVersion",
    versionId: VERSION_ID,
    documentId: DOC,
    tenantId: TENANT,
    seq: SEQ,
    state: "RECEIVED",
    origin: "MANUAL_UPLOAD",
    pendingFileScans: 0,
    infectedFileScans: 0,
    principalFileId: FILE,
    totalFiles: 1,
    fileSetSealed: true,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    version: 2,
    ...overrides,
  };
}

class FakeExtractionRunStore implements ExtractionRunStore {
  public readonly items = new Map<string, unknown>();
  async get(): Promise<undefined> {
    throw new Error("not used by startExtractionRunForDocumentArchive");
  }
  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    const key = `${item.PK}#${item.SK}`;
    if (this.items.has(key)) return false;
    this.items.set(key, item);
    return true;
  }
  async updateStatus(): Promise<boolean> {
    throw new Error("not used by startExtractionRunForDocumentArchive");
  }
}

class FakeExecutionStarter implements ExtractionExecutionStarter {
  public readonly calls: { name: string; input: ExtractionExecutionInput }[] = [];
  async startExecution(input: { name: string; input: ExtractionExecutionInput }): Promise<void> {
    this.calls.push(input);
  }
}

function seededArchive(items: readonly (EntityKey & object)[], opts: { activeTenant?: boolean } = { activeTenant: true }): InMemoryDocumentArchiveStore {
  const seed = opts.activeTenant === false ? items : [...items, seedActiveTenantLifecycle(TENANT)];
  return new InMemoryDocumentArchiveStore(seed as unknown as (Record<string, unknown> & EntityKey)[]);
}

const INPUT = { tenantId: TENANT, documentId: DOC, versionId: VERSION_ID, fileId: FILE, observedCleanObject: CLEAN_OBJECT, correlationId: "corr-archive-1" };

describe("startExtractionRunForDocumentArchive — D-193 item 3/9, 5 fresh-re-read preconditions", () => {
  it("opens the gate (creates the idempotent ExtractionRun) AND starts the real Step Functions execution when all 5 preconditions pass (D-193 slice 3: the KNOWN GAP slice 2 left is resolved - this is no longer gate-and-record only)", async () => {
    const archive = seededArchive([baseFile(), baseVersion()]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions, now: () => "2026-09-03T00:05:00.000Z" }, INPUT);

    expect(outcome).toEqual({ outcome: "GATE_OPENED" });
    const expectedRunId = deriveExtractionRunId(TENANT, DOC, VERSION_ID, PIPELINE_VERSION_V1);
    const stored = runs.items.get(`${extractionRunKey(TENANT, DOC, expectedRunId).PK}#${extractionRunKey(TENANT, DOC, expectedRunId).SK}`) as
      | { status: string; tenantId: string; documentId: string; versionId: string }
      | undefined;
    expect(stored?.status).toBe("RUNNING");
    expect(stored?.versionId).toBe(VERSION_ID);

    expect(executions.calls).toHaveLength(1);
    expect(executions.calls[0]?.name).toBe(expectedRunId);
    expect(executions.calls[0]?.input).toEqual({
      tenantId: TENANT,
      documentSource: "DOCUMENT_ARCHIVE",
      itemId: DOC,
      documentId: DOC,
      documentVersion: SEQ,
      runId: expectedRunId,
      pipelineVersion: PIPELINE_VERSION_V1,
      correlationId: "corr-archive-1",
      cleanObject: CLEAN_OBJECT,
      fileName: "",
      contentType: "application/pdf",
    });
  });

  it("is idempotent: a second call for the same version finds the run already there (ALREADY_OPENED) but still calls startExecution again (AWS-side idempotency via the deterministic runId is the real dedup, same discipline as the OLD trigger)", async () => {
    const archive = seededArchive([baseFile(), baseVersion()]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const deps = { archive, runs, executions };

    const first = await startExtractionRunForDocumentArchive(deps, INPUT);
    const second = await startExtractionRunForDocumentArchive(deps, INPUT);

    expect(first).toEqual({ outcome: "GATE_OPENED" });
    expect(second).toEqual({ outcome: "ALREADY_OPENED" });
    expect(executions.calls).toHaveLength(2);
    expect(executions.calls[0]?.name).toBe(executions.calls[1]?.name);
  });

  // ---------------------------------------------------------------------------------------
  // Each of the 5 preconditions individually violated -> REFUSED with the right typed reason.
  // ---------------------------------------------------------------------------------------

  it("precondition 1 (FILE_NOT_CLEAN): refuses when the freshly-read DocumentFile is not scanStatus=CLEAN", async () => {
    const archive = seededArchive([baseFile({ scanStatus: "SCANNING", cleanObject: undefined }), baseVersion()]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "FILE_NOT_CLEAN" });
  });

  it("precondition 2 (CLEAN_OBJECT_MISMATCH): refuses when the fresh DocumentFile.cleanObject does not match the observed event's object exactly", async () => {
    const archive = seededArchive([baseFile({ cleanObject: { ...CLEAN_OBJECT, versionId: "some-other-version" } }), baseVersion()]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "CLEAN_OBJECT_MISMATCH" });
  });

  it("precondition 3 (NOT_PRINCIPAL): refuses for an ATTACHMENT file - only PRINCIPAL ever triggers OCR", async () => {
    const archive = seededArchive([baseFile({ role: "ATTACHMENT" }), baseVersion()]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "NOT_PRINCIPAL" });
  });

  it("precondition 4 (VERSION_NOT_ELIGIBLE): refuses when the fresh DocumentVersion.state is not RECEIVED/UNDER_REVIEW/ACCEPTED", async () => {
    const archive = seededArchive([baseFile(), baseVersion({ state: "SUPERSEDED" })]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "VERSION_NOT_ELIGIBLE" });
  });

  it("precondition 4 (VERSION_NOT_FOUND): refuses when the DocumentVersion row itself is missing", async () => {
    const archive = seededArchive([baseFile()]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "VERSION_NOT_FOUND" });
  });

  it("precondition 5 (TENANT_NOT_ACTIVE): refuses when there is no ACTIVE TenantLifecycleRecord, even though file/version both look eligible", async () => {
    const archive = seededArchive([baseFile(), baseVersion()], { activeTenant: false });
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "TENANT_NOT_ACTIVE" });
  });

  it("FILE_NOT_FOUND: refuses when versionId/fileId cannot be resolved to any DocumentFile at all", async () => {
    const archive = seededArchive([]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "FILE_NOT_FOUND" });
  });

  // ---------------------------------------------------------------------------------------
  // Fresh-re-read (TOCTOU) proof: a stale/cached view of DocumentFile would have incorrectly
  // allowed a start that the fresh read correctly blocks.
  // ---------------------------------------------------------------------------------------

  it("TOCTOU: a caller holding a stale (already-CLEAN) snapshot from before a concurrent rejection would incorrectly allow the start - the fresh re-read this function actually performs correctly blocks it", async () => {
    // Simulates the caller's earlier, now-stale observation: at the time the S3 clean-bucket
    // event was fired, the file really was CLEAN with this exact object. Below, before this
    // function is invoked, the file is stipulated to have concurrently moved to REJECTED
    // (e.g. a compensating action / a race this design's own tenant-fence discipline allows
    // for) - a caller trusting the STALE observation alone would proceed; this function's own
    // fresh `deps.archive.get()` read observes the CURRENT row instead and correctly refuses.
    const staleObservation = baseFile(); // scanStatus: CLEAN, exactly what a stale cache would say
    expect(staleObservation.scanStatus).toBe("CLEAN"); // sanity: the stale view says "go"

    const archive = seededArchive([baseFile({ scanStatus: "REJECTED", cleanObject: undefined }), baseVersion({ pendingFileScans: 0, infectedFileScans: 1 })]);
    const runs = new FakeExtractionRunStore();
    const executions = new FakeExecutionStarter();
    const outcome = await startExtractionRunForDocumentArchive({ archive, runs, executions }, INPUT);
    expect(executions.calls).toHaveLength(0);

    // The fresh read, not the stale CLEAN observation above, decides the outcome.
    expect(outcome).toEqual({ outcome: "REFUSED", reason: "FILE_NOT_CLEAN" });
  });
});
