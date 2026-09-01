import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../src/shared/errors/app-error.js";
import { buildVersionedUpdate } from "../../../src/shared/dynamodb/occ.js";

function makeIds(): DocumentArchiveIdGenerator {
  let n = 0;
  return {
    newDocumentId: () => `doc-${++n}`,
    newVersionId: () => `ver-${++n}`,
    newEventId: () => `evt-${++n}`,
  };
}

function makeService(store = new InMemoryDocumentArchiveStore()) {
  const service = new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), now: () => "2026-09-01T00:00:00.000Z" });
  return { service, store };
}

const TENANT = "tenant-1";

describe("DocumentArchiveService (D-143 Nucleus 1)", () => {
  it("creates a Document with GSI1 keys reflecting ACTIVE status", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(TENANT, { subjectId: "subject-1", documentType: "ALVARA", hasValidity: true });
    expect(doc.status).toBe("ACTIVE");
    expect(doc.GSI1PK).toBe(`TENANT#${TENANT}#DOCSTATUS#ACTIVE`);
    expect(doc.version).toBe(1);
  });

  it("full happy path: reserveUpload -> commitUpload -> claimReview -> acceptVersion", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(TENANT, { subjectId: "s1", documentType: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(TENANT, doc.documentId, "MANUAL_UPLOAD");
    expect(draft.state).toBe("DRAFT");

    const received = await service.commitUpload(TENANT, doc.documentId, draft.seq, draft.version);
    expect(received.state).toBe("RECEIVED");

    const underReview = await service.claimReview(TENANT, doc.documentId, draft.seq, received.version, "user-1");
    expect(underReview.state).toBe("UNDER_REVIEW");
    expect(underReview.reviewerId).toBe("user-1");

    const result = await service.acceptVersion(TENANT, doc.documentId, draft.seq, underReview.version, "user-1", "req-token-1");
    expect(result.acceptedVersionId).toBe(draft.versionId);
    expect(result.document.currentVersionId).toBe(draft.versionId);

    const finalVersion = (await service.listVersions(TENANT, doc.documentId)).find((v) => v.seq === draft.seq);
    expect(finalVersion?.state).toBe("ACCEPTED");
  });

  it("a renewal supersedes the previous ACCEPTED version atomically", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(TENANT, { subjectId: "s1", documentType: "ALVARA", hasValidity: true });

    const v1 = await service.reserveUpload(TENANT, doc.documentId, "MANUAL_UPLOAD");
    const v1r = await service.commitUpload(TENANT, doc.documentId, v1.seq, v1.version);
    const v1u = await service.claimReview(TENANT, doc.documentId, v1.seq, v1r.version, "user-1");
    await service.acceptVersion(TENANT, doc.documentId, v1.seq, v1u.version, "user-1", "req-token-1");

    const v2 = await service.reserveUpload(TENANT, doc.documentId, "MANUAL_UPLOAD");
    const v2r = await service.commitUpload(TENANT, doc.documentId, v2.seq, v2.version);
    const v2u = await service.claimReview(TENANT, doc.documentId, v2.seq, v2r.version, "user-1");
    const result = await service.acceptVersion(TENANT, doc.documentId, v2.seq, v2u.version, "user-1", "req-token-2");

    expect(result.document.currentVersionId).toBe(v2.versionId);
    const versions = await service.listVersions(TENANT, doc.documentId);
    const supersededV1 = versions.find((v) => v.seq === v1.seq);
    const acceptedV2 = versions.find((v) => v.seq === v2.seq);
    expect(supersededV1?.state).toBe("SUPERSEDED");
    expect(acceptedV2?.state).toBe("ACCEPTED");
  });

  it("acceptVersion is idempotent: replaying the same clientRequestToken returns the persisted snapshot, not a fresh read", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(TENANT, { subjectId: "s1", documentType: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(TENANT, doc.documentId, "MANUAL_UPLOAD");
    const v1r = await service.commitUpload(TENANT, doc.documentId, v1.seq, v1.version);
    const v1u = await service.claimReview(TENANT, doc.documentId, v1.seq, v1r.version, "user-1");

    const first = await service.acceptVersion(TENANT, doc.documentId, v1.seq, v1u.version, "user-1", "same-token");
    // Replay with the SAME expectedVersion (as a real retry after a lost response would) and
    // the same token - must return the original snapshot without throwing, even though the
    // Version has already moved past `v1u.version` in reality.
    const replay = await service.acceptVersion(TENANT, doc.documentId, v1.seq, v1u.version, "user-1", "same-token");
    expect(replay).toEqual(first);
  });

  it("rejects a claim collision: a second reviewer cannot claim a version another reviewer already claimed", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(TENANT, { subjectId: "s1", documentType: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(TENANT, doc.documentId, "MANUAL_UPLOAD");
    const v1r = await service.commitUpload(TENANT, doc.documentId, v1.seq, v1.version);
    await service.claimReview(TENANT, doc.documentId, v1.seq, v1r.version, "user-1");

    await expect(service.claimReview(TENANT, doc.documentId, v1.seq, v1r.version, "user-2")).rejects.toThrow(ConflictError);
  });

  it("REJECTED is terminal: accepting a rejected version is rejected as a conflict (never removable, never re-acceptable, per J9)", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(TENANT, { subjectId: "s1", documentType: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(TENANT, doc.documentId, "MANUAL_UPLOAD");
    const v1r = await service.commitUpload(TENANT, doc.documentId, v1.seq, v1.version);
    const rejected = await service.rejectVersion(TENANT, doc.documentId, v1.seq, v1r.version, "user-1", "ILLEGIBLE");
    expect(rejected.state).toBe("REJECTED");

    await expect(service.acceptVersion(TENANT, doc.documentId, v1.seq, rejected.version, "user-1", "tok")).rejects.toThrow(ConflictError);
  });

  it("acceptVersion is blocked while a file scan is pending or infected", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(TENANT, { subjectId: "s1", documentType: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(TENANT, doc.documentId, "MANUAL_UPLOAD");
    const v1r = await service.commitUpload(TENANT, doc.documentId, v1.seq, v1.version);
    const v1u = await service.claimReview(TENANT, doc.documentId, v1.seq, v1r.version, "user-1");

    // Simulate a complementary file still pending scan.
    const key = { PK: v1u.PK, SK: v1u.SK };
    await store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: "test-table",
          key,
          tenantId: TENANT,
          expectedVersion: v1u.version,
          set: { pendingFileScans: 1 },
        }),
      },
    ]);
    const withPendingScan = await store.get<typeof v1u>(key);

    await expect(service.acceptVersion(TENANT, doc.documentId, v1.seq, withPendingScan!.version, "user-1", "tok")).rejects.toThrow(ValidationError);
  });

  it("getDocument throws NotFoundError for an unknown document", async () => {
    const { service } = makeService();
    await expect(service.getDocument(TENANT, "missing")).rejects.toThrow(NotFoundError);
  });
});
