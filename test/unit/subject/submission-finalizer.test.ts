import { describe, expect, it } from "vitest";
import { InMemorySubjectStore } from "./in-memory-store.js";
import { finalizeSubmissionUpload } from "../../../src/workers/submission-finalizer/finalizer.js";
import { documentSubmissionKey, type DocumentSubmission } from "../../../src/modules/subject/domain/document-submission.js";
import type { DocumentObjectStore } from "../../../src/modules/document/ports/document-object-store.js";
import type { SubjectStore } from "../../../src/modules/subject/ports/subject-store.js";
import type { PdfParser } from "../../../src/modules/document/ports/pdf-parser.js";

const TABLE = "MainTable";
const CLEAN_BUCKET = "clean-bucket";
const OBJECT = { bucket: "quarantine-bucket", key: "quarantine/sub1/slot1/abc", versionId: "v1" };

function baseSubmission(overrides: Partial<DocumentSubmission> = {}): DocumentSubmission {
  return {
    ...documentSubmissionKey("t1", "subject1", "assign1", "sub1"),
    entityType: "DocumentSubmission",
    submissionId: "sub1",
    tenantId: "t1",
    subjectId: "subject1",
    assignmentId: "assign1",
    documentRequestId: "docreq1",
    fileName: "a.pdf",
    mediaType: "application/pdf",
    contentLength: 100,
    checksumSha256: "a".repeat(64),
    status: "PENDING_UPLOAD",
    quarantineObject: OBJECT,
    version: 1,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

function fakeParser(outcome: "VALID" | "INVALID_STRUCTURE" = "VALID"): PdfParser {
  return { parse: async () => ({ outcome, pageCount: 1 }) };
}

function fakeObjects(overrides: Partial<DocumentObjectStore> = {}): DocumentObjectStore {
  return {
    headObject: async () => ({ contentLength: 100, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }),
    copyObject: async (_s, destBucket, destKey) => ({ bucket: destBucket, key: destKey, versionId: "clean-v1" }),
    deleteObjectVersion: async () => undefined,
    ...overrides,
  };
}

const INPUT_BASE = { tenantId: "t1", subjectId: "subject1", assignmentId: "assign1", submissionId: "sub1", object: OBJECT };

describe("finalizeSubmissionUpload", () => {
  it("confirms and transitions to SCANNING on a valid matching object", async () => {
    const store = new InMemorySubjectStore();
    await store.putIfAbsent(baseSubmission());
    const outcome = await finalizeSubmissionUpload(
      { store, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      INPUT_BASE,
    );
    expect(outcome).toBe("CONFIRMED");
    const submission = (await store.get(documentSubmissionKey("t1", "subject1", "assign1", "sub1"))) as DocumentSubmission;
    expect(submission.status).toBe("SCANNING");
    expect(submission.uploadEvidence?.valid).toBe(true);
  });

  it("rejects when the observed size doesn't match what was declared", async () => {
    const store = new InMemorySubjectStore();
    await store.putIfAbsent(baseSubmission());
    const badObjects = fakeObjects({ headObject: async () => ({ contentLength: 999, mediaType: "application/pdf", checksumSha256: "a".repeat(64) }) });
    const outcome = await finalizeSubmissionUpload({ store, objects: badObjects, parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET }, INPUT_BASE);
    expect(outcome).toBe("REJECTED_INVALID");
    const submission = (await store.get(documentSubmissionKey("t1", "subject1", "assign1", "sub1"))) as DocumentSubmission;
    expect(submission.status).toBe("REJECTED");
  });

  it("rejects when the PDF sandbox parser reports invalid structure", async () => {
    const store = new InMemorySubjectStore();
    await store.putIfAbsent(baseSubmission());
    const outcome = await finalizeSubmissionUpload(
      { store, objects: fakeObjects(), parser: fakeParser("INVALID_STRUCTURE"), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      INPUT_BASE,
    );
    expect(outcome).toBe("REJECTED_INVALID");
  });

  it("ignores an event for a submission that doesn't exist (fail-closed)", async () => {
    const store = new InMemorySubjectStore();
    const outcome = await finalizeSubmissionUpload(
      { store, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET },
      { ...INPUT_BASE, submissionId: "missing" },
    );
    expect(outcome).toBe("IGNORED_UNKNOWN_SLOT");
  });

  it("ignores a redelivered event for a submission already past SCANNING (terminal)", async () => {
    const store = new InMemorySubjectStore();
    await store.putIfAbsent(baseSubmission({ status: "CLEAN" }));
    const outcome = await finalizeSubmissionUpload({ store, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET }, INPUT_BASE);
    expect(outcome).toBe("IGNORED_STALE");
  });

  it("retries and still confirms when the malware-result worker's own evidence write races in between this worker's read and write (mesma lição real de M6)", async () => {
    const store = new InMemorySubjectStore();
    await store.putIfAbsent(baseSubmission());
    let getCalls = 0;
    const racingStore: SubjectStore = {
      get: async <T,>(key: Parameters<SubjectStore["get"]>[0]) => {
        getCalls += 1;
        const submission = await store.get<DocumentSubmission>(key);
        if (getCalls === 1 && submission) {
          await store.update({ ...submission, malwareEvidence: { object: OBJECT, status: "NO_THREATS_FOUND", scanResultId: "scan-1", observedAt: "2026-08-23T00:00:01.000Z" }, version: 2 });
        }
        return submission as unknown as T;
      },
      transactWrite: store.transactWrite.bind(store),
      putIfAbsent: store.putIfAbsent.bind(store),
      update: store.update.bind(store),
      updateConditional: store.updateConditional.bind(store),
      queryGsi7: store.queryGsi7.bind(store),
      queryByPk: store.queryByPk.bind(store),
    };

    const outcome = await finalizeSubmissionUpload({ store: racingStore, objects: fakeObjects(), parser: fakeParser(), tableName: TABLE, cleanBucket: CLEAN_BUCKET }, INPUT_BASE);

    expect(outcome).toBe("CONFIRMED");
    expect(getCalls).toBeGreaterThanOrEqual(2);
    const submission = store.allItems().find((i) => i["entityType"] === "DocumentSubmission") as unknown as DocumentSubmission | undefined;
    expect(submission?.status).toBe("CLEAN");
    expect(submission?.uploadEvidence?.valid).toBe(true);
    expect(submission?.malwareEvidence?.status).toBe("NO_THREATS_FOUND");
  });
});
