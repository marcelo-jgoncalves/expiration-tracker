import { describe, expect, it } from "vitest";
import { buildCreateDocumentEntries, DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveDocumentType, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "./in-memory-store.js";
import { AuthorizationError, ConflictError, DocumentTypeNotActiveError, NotFoundError, SubjectPreconditionFailedError, ValidationError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { buildVersionedUpdate } from "../../../src/shared/dynamodb/occ.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { documentFileKey } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentTypeKey } from "../../../src/modules/document-archive/domain/document-type.js";
import type { UploadUrlSigner, PresignUploadInput, PresignUploadResult } from "../../../src/modules/document/ports/upload-url-signer.js";

/** Fake signer, not a stub that just resolves undefined — records every call so tests can
 * assert `reserveFiles()` actually invokes it with the real key/bucket per file (G-V3). */
function makeSigner(): UploadUrlSigner & { calls: PresignUploadInput[] } {
  const calls: PresignUploadInput[] = [];
  return {
    calls,
    presignUpload: async (input: PresignUploadInput): Promise<PresignUploadResult> => {
      calls.push(input);
      return { uploadUrl: `https://s3.example/${input.bucket}/${input.key}?sig=fake`, requiredHeaders: { "x-amz-checksum-sha256": input.checksumSha256 } };
    },
  };
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["MEMBER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function ctxAs(userId: string, roles: string[] = ["MEMBER"]): RequestContext {
  return ctx({ principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: `session-${userId}` }, tenant: { tenantId: "tenant-1", roles } });
}

function makeIds(): DocumentArchiveIdGenerator {
  let n = 0;
  return {
    newDocumentId: () => `doc-${++n}`,
    newVersionId: () => `ver-${++n}`,
    newEventId: () => `evt-${++n}`,
    newRequirementId: () => `req-${++n}`,
    newSeriesId: () => `series-${++n}`,
    newDocumentRequestId: () => `docreq-${++n}`,
    newFileId: () => `file-${++n}`,
    newDocumentTypeId: () => `doctype-${++n}`,
  newRequirementTemplateId: () => "reqtpl_test",
  newRequirementTemplateItemId: () => `reqtplitem_${crypto.randomUUID()}`,
  };
}

function makeService(
  store = new InMemoryDocumentArchiveStore([
    seedActiveDocumentType(TENANT, "ALVARA"),
    seedActiveTenantLifecycle(TENANT),
    // D-192 §5: createDocument() now fences the owning Subject too — every fixture in this
    // suite that doesn't test that fence itself needs a real ACTIVE TrackedSubject at the
    // literal subjectIds ("s1"/"subject-1") the rest of the file already uses.
    seedActiveTrackedSubject(TENANT, "s1"),
    seedActiveTrackedSubject(TENANT, "subject-1"),
  ]),
  signer: UploadUrlSigner = makeSigner(),
) {
  const service = new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer, now: () => "2026-09-01T00:00:00.000Z" });
  return { service, store, signer };
}

const TENANT = "tenant-1";

/** Shared fixture helper: `commitUpload()` requires the file set to be sealed (`fileSetSealed`
 * gate, D-163 §4, activated in this slice) — every test exercising the DRAFT->RECEIVED
 * transition must call `reserveFiles()` first now, not just `reserveUpload()`. Also marks the
 * PRINCIPAL `DocumentFile` CLEAN and reconciles the Version's `pendingFileScans` counter back to
 * zero, standing in for the real terminal scan transition (`applyFileScanResult`/
 * `confirmFileScanClean`, D-165) — most fixtures in this suite drive the lifecycle all the way
 * to `acceptVersion()`, whose PRINCIPAL fence (D-163 §5) requires `scanStatus === "CLEAN"` on
 * the reserved PRINCIPAL, not just a sealed file set. Returns the DocumentVersion's fresh
 * `version` for the caller to pass to `commitUpload()`. */
async function sealDraft(
  service: DocumentArchiveService,
  store: InMemoryDocumentArchiveStore,
  documentId: string,
  seq: number,
  expectedVersion: number,
): Promise<number> {
  const reserved = await service.reserveFiles(ctx(), documentId, seq, expectedVersion, [{ role: "PRINCIPAL", mediaType: "application/pdf", contentLength: 1024, checksumSha256: "a".repeat(64) }]);
  const principal = reserved[0]!.file;
  const sealed = await store.get<DocumentVersion>(documentVersionKey(TENANT, documentId, seq));
  await store.transactWrite([
    {
      Update: buildVersionedUpdate({
        tableName: "test-table",
        key: documentFileKey(TENANT, documentId, seq, principal.fileId),
        tenantId: TENANT,
        expectedVersion: principal.version,
        set: { scanStatus: "CLEAN" },
      }),
    },
    {
      Update: buildVersionedUpdate({
        tableName: "test-table",
        key: { PK: sealed!.PK, SK: sealed!.SK },
        tenantId: TENANT,
        expectedVersion: sealed!.version,
        set: { pendingFileScans: 0 },
      }),
    },
  ]);
  const final = await store.get<DocumentVersion>(documentVersionKey(TENANT, documentId, seq));
  return final!.version;
}

describe("DocumentArchiveService (D-143 Nucleus 1)", () => {
  it("creates a Document with GSI1 keys reflecting ACTIVE status", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "subject-1", documentTypeId: "ALVARA", hasValidity: true });
    expect(doc.status).toBe("ACTIVE");
    expect(doc.GSI1PK).toBe(`TENANT#${TENANT}#DOCSTATUS#ACTIVE`);
    expect(doc.version).toBe(1);
  });

  it("creates a Document with GSI2 keys reflecting subject+documentTypeId (AP3, Documents-by-Subject — D-161 regression: was never written)", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "subject-1", documentTypeId: "ALVARA", hasValidity: true });
    expect(doc.GSI2PK).toBe(`TENANT#${TENANT}#SUBJECT#subject-1#DOC`);
    expect(doc.GSI2SK).toBe(`DOCTYPE#ALVARA#DOCUMENT#${doc.documentId}`);
  });

  /** G-V3 (D-176, item 4 of D-173's "Próximo passo real"): `documentGsi2Keys()` must partition
   * by the DocumentType's stable `documentTypeId`, never by its renamable `displayName` —
   * renaming a DocumentType must not move where an already-written Document sits in GSI2.
   * Proven by creating the DocumentType and Document first, then renaming the DocumentType,
   * then re-reading the Document and asserting GSI2SK is byte-identical to before the rename
   * (revert this test's rename call — leave GSI2SK computed from `newDisplayName` — to confirm
   * it actually fails without the fix: an id-stable GSI2SK cannot regress silently). */
  it("documentGsi2Keys() partitions by the stable documentTypeId, unaffected by a later DocumentType displayName rename", async () => {
    const { service } = makeService();
    const admin = ctxAs("admin-1", ["ADMIN"]);
    const created = await service.createDocumentType(admin, { displayName: "Alvará Sanitário" });
    const doc = await service.createDocument(ctx(), { subjectId: "subject-1", documentTypeId: created.documentTypeId, hasValidity: true });
    const gsi2skBeforeRename = doc.GSI2SK;
    expect(gsi2skBeforeRename).toBe(`DOCTYPE#${created.documentTypeId}#DOCUMENT#${doc.documentId}`);

    await service.renameDocumentType(admin, created.documentTypeId, created.version, "Alvará Sanitário Municipal");

    const reread = await service.getDocument(ctx(), doc.documentId);
    expect(reread.GSI2SK).toBe(gsi2skBeforeRename);
    expect(reread.GSI2SK).not.toContain("Municipal");
  });

  it("VIEWER cannot create a Document or upload a version (RBAC: docarchive:create/upload require WRITE_ROLES)", async () => {
    const { service } = makeService();
    const viewer = ctxAs("viewer-1", ["VIEWER"]);
    await expect(service.createDocument(viewer, { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true })).rejects.toThrow(AuthorizationDeniedError);
  });

  /** D-173 §4/item 3: proves the new `ConditionCheck` genuinely blocks `createDocument()` when
   * the referenced DocumentType has actually flipped to DEPRECATED (not merely "doesn't
   * exist") — TOCTOU-safe by construction since the check runs inside the same
   * `TransactWriteItems` as the Document `Put`, never a separate read-before-write. */
  it("rejects createDocument() with DocumentTypeNotActiveError when the referenced DocumentType is DEPRECATED", async () => {
    const { service, store } = makeService();
    await store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: "test-table",
          key: documentTypeKey(TENANT, "ALVARA"),
          tenantId: TENANT,
          expectedVersion: 1,
          set: { status: "DEPRECATED" },
        }),
      },
    ]);
    await expect(service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true })).rejects.toThrow(DocumentTypeNotActiveError);
  });

  it("createDocument() still succeeds against an ACTIVE DocumentType after the DEPRECATED case above (mechanism isn't globally broken)", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    expect(doc.documentTypeId).toBe("ALVARA");
  });

  /** G-V3 (D-192 §5, gap `DA-SUBJECT-FENCE-01`): before this fix `createDocument()` never
   * checked the owning Subject at all — it would happily create a Document under a Subject id
   * that doesn't exist. Must fail with the SAME typed error `createRequirement()` already uses
   * for this precondition (`SubjectPreconditionFailedError`), never a generic 500/transaction-
   * canceled leak. Proven by pointing at a store that seeds NO TrackedSubject for this id. */
  it("rejects createDocument() with SubjectPreconditionFailedError when the referenced Subject does not exist", async () => {
    const { service } = makeService(new InMemoryDocumentArchiveStore([seedActiveDocumentType(TENANT, "ALVARA"), seedActiveTenantLifecycle(TENANT)]));
    await expect(service.createDocument(ctx(), { subjectId: "no-such-subject", documentTypeId: "ALVARA", hasValidity: true })).rejects.toThrow(SubjectPreconditionFailedError);
  });

  /** G-V3, second half: an ARCHIVED Subject must be rejected too — `<> DELETED` would wrongly
   * let this through (`TrackedSubjectStatus` is `ACTIVE | ARCHIVED | DELETED`), so the fence must
   * be an ENUMERATED `status = ACTIVE` check, same discipline as `buildSubjectFence()`. */
  it("rejects createDocument() with SubjectPreconditionFailedError when the referenced Subject is ARCHIVED", async () => {
    const archivedSubject = { ...seedActiveTrackedSubject(TENANT, "archived-subject"), status: "ARCHIVED" };
    const { service } = makeService(new InMemoryDocumentArchiveStore([seedActiveDocumentType(TENANT, "ALVARA"), seedActiveTenantLifecycle(TENANT), archivedSubject]));
    await expect(service.createDocument(ctx(), { subjectId: "archived-subject", documentTypeId: "ALVARA", hasValidity: true })).rejects.toThrow(SubjectPreconditionFailedError);
  });

  /** Regression guard: the two rejections above must not be a side effect of a globally-broken
   * fence — creating against a real ACTIVE Subject must keep succeeding. */
  it("createDocument() still succeeds against an ACTIVE Subject (regression guard for the fence above)", async () => {
    const { service } = makeService(new InMemoryDocumentArchiveStore([seedActiveDocumentType(TENANT, "ALVARA"), seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "s1")]));
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    expect(doc.subjectId).toBe("s1");
  });

  it("full happy path: reserveUpload -> commitUpload -> claimReview -> acceptVersion", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    expect(draft.state).toBe("DRAFT");

    const sealedVersion = await sealDraft(service, store, doc.documentId, draft.seq, draft.version);
    const received = await service.commitUpload(ctx(), doc.documentId, draft.seq, sealedVersion);
    expect(received.state).toBe("RECEIVED");

    const underReview = await service.claimReview(ctx(), doc.documentId, draft.seq, received.version);
    expect(underReview.state).toBe("UNDER_REVIEW");
    expect(underReview.reviewerId).toBe("user-1");

    const result = await service.acceptVersion(ctx(), doc.documentId, draft.seq, underReview.version, "req-token-1");
    expect(result.acceptedVersionId).toBe(draft.versionId);
    expect(result.document.currentVersionId).toBe(draft.versionId);

    const finalVersion = (await service.listVersions(ctx(), doc.documentId)).find((v) => v.seq === draft.seq);
    expect(finalVersion?.state).toBe("ACCEPTED");
  });

  it("a renewal supersedes the previous ACCEPTED version atomically", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });

    const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const v1sealed = await sealDraft(service, store, doc.documentId, v1.seq, v1.version);
    const v1r = await service.commitUpload(ctx(), doc.documentId, v1.seq, v1sealed);
    const v1u = await service.claimReview(ctx(), doc.documentId, v1.seq, v1r.version);
    await service.acceptVersion(ctx(), doc.documentId, v1.seq, v1u.version, "req-token-1");

    const v2 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const v2sealed = await sealDraft(service, store, doc.documentId, v2.seq, v2.version);
    const v2r = await service.commitUpload(ctx(), doc.documentId, v2.seq, v2sealed);
    const v2u = await service.claimReview(ctx(), doc.documentId, v2.seq, v2r.version);
    const result = await service.acceptVersion(ctx(), doc.documentId, v2.seq, v2u.version, "req-token-2");

    expect(result.document.currentVersionId).toBe(v2.versionId);
    const versions = await service.listVersions(ctx(), doc.documentId);
    const supersededV1 = versions.find((v) => v.seq === v1.seq);
    const acceptedV2 = versions.find((v) => v.seq === v2.seq);
    expect(supersededV1?.state).toBe("SUPERSEDED");
    expect(acceptedV2?.state).toBe("ACCEPTED");
  });

  it("acceptVersion is idempotent: replaying the same clientRequestToken returns the persisted snapshot, not a fresh read", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const v1sealed = await sealDraft(service, store, doc.documentId, v1.seq, v1.version);
    const v1r = await service.commitUpload(ctx(), doc.documentId, v1.seq, v1sealed);
    const v1u = await service.claimReview(ctx(), doc.documentId, v1.seq, v1r.version);

    const first = await service.acceptVersion(ctx(), doc.documentId, v1.seq, v1u.version, "same-token");
    // Replay with the SAME expectedVersion (as a real retry after a lost response would) and
    // the same token - must return the original snapshot without throwing, even though the
    // Version has already moved past `v1u.version` in reality.
    const replay = await service.acceptVersion(ctx(), doc.documentId, v1.seq, v1u.version, "same-token");
    expect(replay).toEqual(first);
  });

  it("rejects a claim collision: a second reviewer cannot claim a version another reviewer already claimed", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const v1sealed = await sealDraft(service, store, doc.documentId, v1.seq, v1.version);
    const v1r = await service.commitUpload(ctx(), doc.documentId, v1.seq, v1sealed);
    await service.claimReview(ctxAs("user-1"), doc.documentId, v1.seq, v1r.version);

    await expect(service.claimReview(ctxAs("user-2"), doc.documentId, v1.seq, v1r.version)).rejects.toThrow(ConflictError);
  });

  it("a MEMBER who did not claim a version cannot accept/reject it; an ADMIN can override (D-143 Decision 1/Bloqueador 6)", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const v1sealed = await sealDraft(service, store, doc.documentId, v1.seq, v1.version);
    const v1r = await service.commitUpload(ctx(), doc.documentId, v1.seq, v1sealed);
    const v1u = await service.claimReview(ctxAs("user-1"), doc.documentId, v1.seq, v1r.version);

    await expect(service.acceptVersion(ctxAs("user-2"), doc.documentId, v1.seq, v1u.version, "tok")).rejects.toThrow(AuthorizationError);
    // An ADMIN bypasses the reviewer-ownership check (content-admin parity, B2B-7/D-097).
    const result = await service.acceptVersion(ctxAs("admin-1", ["ADMIN"]), doc.documentId, v1.seq, v1u.version, "tok-admin");
    expect(result.acceptedVersionId).toBe(v1.versionId);
  });

  it("REJECTED is terminal: accepting a rejected version is rejected as a conflict (never removable, never re-acceptable, per J9)", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const v1sealed = await sealDraft(service, store, doc.documentId, v1.seq, v1.version);
    const v1r = await service.commitUpload(ctx(), doc.documentId, v1.seq, v1sealed);
    const rejected = await service.rejectVersion(ctx(), doc.documentId, v1.seq, v1r.version, "ILLEGIBLE");
    expect(rejected.state).toBe("REJECTED");

    await expect(service.acceptVersion(ctx(), doc.documentId, v1.seq, rejected.version, "tok")).rejects.toThrow(ConflictError);
  });

  it("acceptVersion is blocked while a file scan is pending or infected", async () => {
    const { service, store } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    const v1sealed = await sealDraft(service, store, doc.documentId, v1.seq, v1.version);
    const v1r = await service.commitUpload(ctx(), doc.documentId, v1.seq, v1sealed);
    const v1u = await service.claimReview(ctx(), doc.documentId, v1.seq, v1r.version);

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

    await expect(service.acceptVersion(ctx(), doc.documentId, v1.seq, withPendingScan!.version, "tok")).rejects.toThrow(ValidationError);
  });

  it("commitUpload rejects a DocumentVersion whose file set has never been sealed (D-163 §4 gate, activated once reserveFiles() has a real HTTP precondition, D-167)", async () => {
    const { service } = makeService();
    const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
    const draft = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
    // reserveFiles() was never called — fileSetSealed is absent, same shape as every real DRAFT
    // Version before this slice existed.
    await expect(service.commitUpload(ctx(), doc.documentId, draft.seq, draft.version)).rejects.toThrow(ConflictError);
  });

  it("getDocument throws NotFoundError for an unknown document", async () => {
    const { service } = makeService();
    await expect(service.getDocument(ctx(), "missing")).rejects.toThrow(NotFoundError);
  });

  describe("reserveFiles (D-163)", () => {
    const spec = (role: "PRINCIPAL" | "ATTACHMENT") => ({ role, mediaType: "application/pdf", contentLength: 1024, checksumSha256: "a".repeat(64) });

    it("seals the file set and persists DocumentFile rows, exactly one PRINCIPAL", async () => {
      const { service, store } = makeService();
      const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
      const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

      const reserved = await service.reserveFiles(ctx(), doc.documentId, v1.seq, v1.version, [spec("PRINCIPAL"), spec("ATTACHMENT")]);
      const files = reserved.map((r) => r.file);

      expect(files).toHaveLength(2);
      expect(files.filter((f) => f.role === "PRINCIPAL")).toHaveLength(1);
      expect(files.every((f) => f.scanStatus === "PENDING_UPLOAD")).toBe(true);
      const sealed = await store.get<typeof v1>({ PK: v1.PK, SK: v1.SK });
      expect(sealed!.fileSetSealed).toBe(true);
      expect(sealed!.pendingFileScans).toBe(2);
      expect(sealed!.principalFileId).toBe(files.find((f) => f.role === "PRINCIPAL")!.fileId);
    });

    it("D-179 slice 3: stamps a GSI8 MaintenanceDueIndex pointer on every reserved file at creation, one per WORK#DOCUMENT_FILE_RECONCILIATION/deadline", async () => {
      const { service } = makeService();
      const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
      const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

      const reserved = await service.reserveFiles(ctx(), doc.documentId, v1.seq, v1.version, [spec("PRINCIPAL"), spec("ATTACHMENT")]);

      for (const { file } of reserved) {
        expect(file.GSI8PK).toBe("WORK#DOCUMENT_FILE_RECONCILIATION");
        expect(file.GSI8SK).toMatch(new RegExp(`^.+#TENANT#${TENANT}#${file.fileId}$`));
      }
    });

    it("item 3 (2026-09-02): presigns a real upload URL per file via UploadUrlSigner, keyed to each file's own quarantineObject", async () => {
      const { service, signer } = makeService(
        new InMemoryDocumentArchiveStore([seedActiveDocumentType(TENANT, "ALVARA"), seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "s1")]),
        makeSigner(),
      );
      const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
      const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

      const reserved = await service.reserveFiles(ctx(), doc.documentId, v1.seq, v1.version, [spec("PRINCIPAL"), spec("ATTACHMENT")]);

      const calls = (signer as ReturnType<typeof makeSigner>).calls;
      expect(calls).toHaveLength(2);
      for (const r of reserved) {
        expect(r.uploadUrl).toBe(`https://s3.example/test-quarantine-bucket/${r.file.quarantineObject.key}?sig=fake`);
        expect(r.requiredHeaders["x-amz-checksum-sha256"]).toBe(r.file.checksumSha256);
        const call = calls.find((c) => c.key === r.file.quarantineObject.key);
        expect(call).toBeDefined();
        expect(call!.bucket).toBe("test-quarantine-bucket");
        expect(call!.mediaType).toBe(r.file.mediaType);
        expect(call!.contentLength).toBe(r.file.contentLength);
      }
      // G-V3: break the mechanism by asserting a distinct key per file is actually passed, not
      // a single shared key that would silently make both presigns collide against one object.
      expect(new Set(calls.map((c) => c.key)).size).toBe(2);
    });

    it("rejects a batch with zero or more than one PRINCIPAL", async () => {
      const { service } = makeService();
      const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
      const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
      await expect(service.reserveFiles(ctx(), doc.documentId, v1.seq, v1.version, [spec("ATTACHMENT")])).rejects.toThrow();
      await expect(service.reserveFiles(ctx(), doc.documentId, v1.seq, v1.version, [spec("PRINCIPAL"), spec("PRINCIPAL")])).rejects.toThrow();
    });

    it("a second reserveFiles call with a fresh, correct expectedVersion is still rejected once the set is sealed (D-163 §2, Rodada 1 finding: input validation alone cannot close this)", async () => {
      const { service, store } = makeService();
      const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
      const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");

      await service.reserveFiles(ctx(), doc.documentId, v1.seq, v1.version, [spec("PRINCIPAL")]);
      // Re-read the Version to get the real, up-to-date `version` after the first reservation —
      // the ordinary OCC `version` condition alone would happily accept a second call using
      // this fresh value (it's not stale). Only the `fileSetSealed` fence (not mere input
      // validation of "exactly one PRINCIPAL per batch", which a second distinct-fileId batch
      // would also satisfy) can reject a second, well-formed, up-to-date reservation attempt.
      const sealed = await store.get<typeof v1>({ PK: v1.PK, SK: v1.SK });
      await expect(service.reserveFiles(ctx(), doc.documentId, v1.seq, sealed!.version, [spec("PRINCIPAL")])).rejects.toThrow(ConflictError);
    });

    it("rejects reserving files once the Version has left DRAFT", async () => {
      const { service, store } = makeService();
      const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
      const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
      const sealedVersion = await sealDraft(service, store, doc.documentId, v1.seq, v1.version);
      const received = await service.commitUpload(ctx(), doc.documentId, v1.seq, sealedVersion);
      await expect(service.reserveFiles(ctx(), doc.documentId, v1.seq, received.version, [spec("PRINCIPAL")])).rejects.toThrow(ConflictError);
    });
  });

  describe("acceptVersion's transactional PRINCIPAL fence (D-163 §5)", () => {
    it("rejects acceptVersion when the PRINCIPAL DocumentFile is not CLEAN, even though pendingFileScans/infectedFileScans both read zero", async () => {
      const { service, store } = makeService();
      const doc = await service.createDocument(ctx(), { subjectId: "s1", documentTypeId: "ALVARA", hasValidity: true });
      const v1 = await service.reserveUpload(ctx(), doc.documentId, "MANUAL_UPLOAD");
      const files = (await service.reserveFiles(ctx(), doc.documentId, v1.seq, v1.version, [{ role: "PRINCIPAL", mediaType: "application/pdf", contentLength: 1, checksumSha256: "a".repeat(64) }])).map((r) => r.file);
      const sealed = await store.get<typeof v1>({ PK: v1.PK, SK: v1.SK });
      const v1r = await service.commitUpload(ctx(), doc.documentId, v1.seq, sealed!.version);
      await service.claimReview(ctx(), doc.documentId, v1.seq, v1r.version);

      // Simulate the PRINCIPAL having been rejected as infected and the Version's own
      // counters already reconciled back to zero (as a real terminal-transition transaction
      // would do) — this is exactly the gap D-163's Rodada 2/3 found: hasCleanFileScans()
      // alone (reading only the Version's counters) cannot catch a rejected PRINCIPAL once
      // its counter has been reconciled away; only a direct check against the file itself can.
      const principal = files[0]!;
      const versionAfterReserve = await store.get<typeof v1>({ PK: v1.PK, SK: v1.SK });
      await store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: "test-table",
            key: { PK: principal.PK, SK: principal.SK },
            tenantId: TENANT,
            expectedVersion: principal.version,
            set: { scanStatus: "REJECTED" },
          }),
        },
        {
          Update: buildVersionedUpdate({
            tableName: "test-table",
            key: { PK: v1.PK, SK: v1.SK },
            tenantId: TENANT,
            expectedVersion: versionAfterReserve!.version,
            set: { pendingFileScans: 0 },
          }),
        },
      ]);

      const versionAfterReconcile = await store.get<typeof v1>({ PK: v1.PK, SK: v1.SK });
      await expect(service.acceptVersion(ctx(), doc.documentId, v1.seq, versionAfterReconcile!.version, "tok")).rejects.toThrow(ConflictError);
    });
  });
});

/**
 * D-192 §6: `buildCreateDocumentEntries()` is a pure planner (no I/O) — exported so the future
 * bulk-import commit worker can reuse the exact same `{document, entries, labels}` shape
 * `createDocument()` itself now delegates to, without executing any write. These tests exercise
 * the function directly (never through the service), the same posture `planTemplateApplication`
 * tests would use if isolated from `RequirementTemplateService`.
 */
describe("buildCreateDocumentEntries (D-192 §6, pure planner)", () => {
  const BASE = {
    tableName: "test-table",
    tenantId: "tenant-1",
    documentId: "doc-plan-1",
    subjectId: "subject-plan-1",
    documentTypeId: "ALVARA",
    hasValidity: true,
    now: "2026-09-03T00:00:00.000Z",
  };

  it("builds an ACTIVE Document with GSI1/GSI2 keys and does not execute any write itself", () => {
    const { document, entries, labels } = buildCreateDocumentEntries(BASE);
    expect(document.status).toBe("ACTIVE");
    expect(document.documentId).toBe(BASE.documentId);
    expect(document.subjectId).toBe(BASE.subjectId);
    expect(document.documentTypeId).toBe(BASE.documentTypeId);
    expect(document.GSI1PK).toBe(`TENANT#${BASE.tenantId}#DOCSTATUS#ACTIVE`);
    expect(document.GSI2PK).toBe(`TENANT#${BASE.tenantId}#SUBJECT#${BASE.subjectId}#DOC`);
    // 3 entries: DocumentType fence, Subject fence, Document Put — no more, no less.
    expect(entries).toHaveLength(3);
    expect(labels).toEqual([{ kind: "DOCUMENT_TYPE_FENCE" }, { kind: "SUBJECT_FENCE" }, { kind: "DOCUMENT" }]);
  });

  it("orders entries [DocumentType fence, Subject fence, Document Put] — the same order the labels array assumes for cancellation classification", () => {
    const { entries } = buildCreateDocumentEntries(BASE);
    expect(entries[0]).toHaveProperty("ConditionCheck");
    expect(entries[1]).toHaveProperty("ConditionCheck");
    expect(entries[2]).toHaveProperty("Put");
    expect((entries[0] as { ConditionCheck: { Key: { PK: string } } }).ConditionCheck.Key.PK).toBe(`TENANT#${BASE.tenantId}#DOCTYPE#${BASE.documentTypeId}`);
    expect((entries[1] as { ConditionCheck: { Key: { PK: string } } }).ConditionCheck.Key.PK).toBe(`TENANT#${BASE.tenantId}#SUBJECT#${BASE.subjectId}`);
  });

  it("is deterministic and never mutates DynamoDB by itself — calling it twice with the same input produces byte-identical entries/labels", () => {
    const first = buildCreateDocumentEntries(BASE);
    const second = buildCreateDocumentEntries(BASE);
    expect(second.document).toEqual(first.document);
    expect(second.entries).toEqual(first.entries);
    expect(second.labels).toEqual(first.labels);
  });
});
