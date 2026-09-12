import { describe, expect, it } from "vitest";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import {
  ExternalShareLinkCapExceededError,
  ExternalShareLinkInvalidError,
  ExternalShareLinkService,
} from "../../../src/modules/document-archive/application/external-share-link-service.js";
import { DocumentArchiveGuestRateLimiter } from "../../../src/modules/document-archive/application/document-archive-guest-rate-limiter.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import type { ExternalShareLinkFileStore } from "../../../src/modules/document-archive/ports/external-share-link-file-store.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { documentKey, type Document } from "../../../src/modules/document-archive/domain/document.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { documentFileKey, type DocumentFile } from "../../../src/modules/document-archive/domain/document-file.js";
import { documentTypeKey, type DocumentType } from "../../../src/modules/document-archive/domain/document-type.js";
import { externalShareLinkGsi1Keys, externalShareLinkKey, type ExternalShareLink } from "../../../src/modules/document-archive/domain/external-share-link.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

const PEPPER = "share-link-service-test-pepper";
const IP_AUDIT_PEPPER = "share-link-service-test-ip-audit-pepper";
const TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: "tenant-1" });
const NOW = "2026-09-08T00:00:00.000Z";

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
    newRequirementTemplateItemId: () => `reqtplitem_${++n}`,
    newDossierExportRunId: () => `dossier_${++n}`,
    newDocumentTypeFieldId: () => `doctypefield_${++n}`,
    newDocumentTypeFieldOptionId: () => `doctypefieldopt_${++n}`,
    newShareId: () => `share-${++n}`,
  };
}

function fakeFileStore(): ExternalShareLinkFileStore & { calls: number } {
  return {
    calls: 0,
    async presignDownload() {
      this.calls += 1;
      return "https://example-bucket.s3.amazonaws.com/presigned";
    },
  };
}

function makeService(store: InMemoryDocumentArchiveStore, fileStore: ExternalShareLinkFileStore, now: () => string = () => NOW) {
  const rateLimiter = new DocumentArchiveGuestRateLimiter(store, IP_AUDIT_PEPPER, now);
  const ids = makeIds();
  return { service: new ExternalShareLinkService({ store, tableName: "test-table", ids, rateLimiter, fileStore, pepper: PEPPER, ipAuditPepper: IP_AUDIT_PEPPER, now }), ids };
}

async function seedTenant(store: InMemoryDocumentArchiveStore, status: "ACTIVE" | "HELD" = "ACTIVE"): Promise<void> {
  const record: TenantLifecycleRecord = {
    ...(tenantLifecycleKey(TENANT) as { PK: string; SK: "LIFECYCLE" }),
    entityType: "TenantLifecycleRecord",
    tenantId: TENANT,
    status,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(record);
}

interface Fixture {
  documentId: string;
  versionSeq: number;
  fileId: string;
}

async function seedAcceptedDocument(store: InMemoryDocumentArchiveStore, overrides: { scanStatus?: DocumentFile["scanStatus"]; state?: DocumentVersion["state"]; activeCount?: number } = {}): Promise<Fixture> {
  const documentId = "doc-fixture-1";
  const versionSeq = 1;
  const fileId = "file-fixture-1";
  const versionId = "ver-fixture-1";

  const documentType: DocumentType = {
    ...documentTypeKey(TENANT, "ALVARA"),
    entityType: "DocumentType",
    documentTypeId: "ALVARA",
    tenantId: TENANT,
    displayName: "Alvará de Funcionamento",
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI1PK: `TENANT#${TENANT}#DOCTYPESTATUS#ACTIVE`,
    GSI1SK: `NAME#alvara#DOCTYPE#ALVARA`,
  };
  await store.putIfAbsent(documentType);

  const document: Document = {
    ...documentKey(TENANT, documentId),
    entityType: "Document",
    documentId,
    tenantId: TENANT,
    subjectId: "subject-1",
    documentTypeId: "ALVARA",
    status: "ACTIVE",
    hasValidity: true,
    currentVersionId: versionId,
    activeExternalShareLinkCount: overrides.activeCount,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI1PK: `TENANT#${TENANT}#DOCSTATUS#ACTIVE`,
    GSI1SK: `UPDATED#${NOW}#DOCUMENT#${documentId}`,
    GSI2PK: `TENANT#${TENANT}#SUBJECT#subject-1#DOC`,
    GSI2SK: `DOCTYPE#ALVARA#DOCUMENT#${documentId}`,
  };
  await store.putIfAbsent(document);

  const version: DocumentVersion = {
    ...documentVersionKey(TENANT, documentId, versionSeq),
    entityType: "DocumentVersion",
    versionId,
    documentId,
    tenantId: TENANT,
    seq: versionSeq,
    state: overrides.state ?? "ACCEPTED",
    origin: "MANUAL_UPLOAD",
    issuedAt: "2026-01-01T00:00:00.000Z",
    pendingFileScans: 0,
    infectedFileScans: 0,
    principalFileId: fileId,
    totalFiles: 1,
    fileSetSealed: true,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(version);

  const file: DocumentFile = {
    ...documentFileKey(TENANT, documentId, versionSeq, fileId),
    entityType: "DocumentFile",
    tenantId: TENANT,
    documentId,
    versionId,
    seq: versionSeq,
    fileId,
    role: "PRINCIPAL",
    scanStatus: overrides.scanStatus ?? "CLEAN",
    mediaType: "application/pdf",
    contentLength: 1234,
    checksumSha256: "a".repeat(64),
    quarantineObject: { bucket: "quarantine-bucket", key: `q/${fileId}`, versionId: "qv1" },
    cleanObject: overrides.scanStatus === undefined || overrides.scanStatus === "CLEAN" ? { bucket: "clean-bucket", key: `c/${fileId}`, versionId: "cv1" } : undefined,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(file);

  return { documentId, versionSeq, fileId };
}

describe("ExternalShareLinkService (D-225)", () => {
  it("createShareLink happy path: transactional creation, cap counter incremented, token returned once", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    const { documentId } = await seedAcceptedDocument(store);
    const fileStore = fakeFileStore();
    const { service } = makeService(store, fileStore);

    const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
    expect(created.token.split(".")).toHaveLength(3); // shareId.selector.secret
    expect(created.link.status).toBe("ACTIVE");
    expect(created.link.documentTypeNameSnapshot).toBe("Alvará de Funcionamento");

    const document = await store.get<Document>(documentKey(TENANT, documentId));
    expect(document?.activeExternalShareLinkCount).toBe(1);
  });

  it("rejects creation when the Document has no ACCEPTED version", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    const { documentId } = await seedAcceptedDocument(store, { state: "RECEIVED" });
    const { service } = makeService(store, fakeFileStore());
    await expect(service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" })).rejects.toThrow();
  });

  it("rejects creation when the principal file is not CLEAN", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    const { documentId } = await seedAcceptedDocument(store, { scanStatus: "SCANNING" });
    const { service } = makeService(store, fakeFileStore());
    await expect(service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" })).rejects.toThrow();
  });

  it("cap: throws ExternalShareLinkCapExceededError at 5 active links with none expired to reconcile", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    const { documentId } = await seedAcceptedDocument(store, { activeCount: 5 });
    for (let i = 0; i < 5; i++) {
      const shareId = `share-preexisting-${i}`;
      const link: ExternalShareLink = {
        ...externalShareLinkKey(TENANT, documentId, shareId),
        entityType: "ExternalShareLink",
        tenantId: TENANT,
        documentId,
        documentTypeNameSnapshot: "Alvará de Funcionamento",
        documentVersionId: "ver-fixture-1",
        documentFileId: "file-fixture-1",
        documentFileSeq: 1,
        selectorHash: `selector-hash-${i}`,
        secretHash: `secret-hash-${i}`,
        status: "ACTIVE",
        createdByUserId: "user-1",
        expiresAt: "2027-01-01T00:00:00.000Z", // still in the future — nothing to reconcile
        purgeAfterTtl: 4102444800,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        ...externalShareLinkGsi1Keys(TENANT, documentId, "ACTIVE", NOW, shareId),
      };
      await store.putIfAbsent(link);
    }
    const { service } = makeService(store, fakeFileStore());
    await expect(service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" })).rejects.toThrow(ExternalShareLinkCapExceededError);
  });

  it("cap+reconciliation: reconciles an expired active link (limited to 5) and allows creation in the same attempt", async () => {
    const store = new InMemoryDocumentArchiveStore();
    await seedTenant(store);
    const { documentId } = await seedAcceptedDocument(store, { activeCount: 5 });
    const expiredShareId = "share-expired-1";
    const expiredLink: ExternalShareLink = {
      ...externalShareLinkKey(TENANT, documentId, expiredShareId),
      entityType: "ExternalShareLink",
      tenantId: TENANT,
      documentId,
      documentTypeNameSnapshot: "Alvará de Funcionamento",
      documentVersionId: "ver-fixture-1",
      documentFileId: "file-fixture-1",
      documentFileSeq: 1,
      selectorHash: "selector-hash-expired",
      secretHash: "secret-hash-expired",
      status: "ACTIVE",
      createdByUserId: "user-1",
      expiresAt: "2020-01-01T00:00:00.000Z", // already expired
      purgeAfterTtl: 1,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
      ...externalShareLinkGsi1Keys(TENANT, documentId, "ACTIVE", NOW, expiredShareId),
    };
    await store.putIfAbsent(expiredLink);
    for (let i = 0; i < 4; i++) {
      const shareId = `share-preexisting-${i}`;
      const link: ExternalShareLink = {
        ...externalShareLinkKey(TENANT, documentId, shareId),
        entityType: "ExternalShareLink",
        tenantId: TENANT,
        documentId,
        documentTypeNameSnapshot: "Alvará de Funcionamento",
        documentVersionId: "ver-fixture-1",
        documentFileId: "file-fixture-1",
        documentFileSeq: 1,
        selectorHash: `selector-hash-${i}`,
        secretHash: `secret-hash-${i}`,
        status: "ACTIVE",
        createdByUserId: "user-1",
        expiresAt: "2027-01-01T00:00:00.000Z",
        purgeAfterTtl: 4102444800,
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        ...externalShareLinkGsi1Keys(TENANT, documentId, "ACTIVE", NOW, shareId),
      };
      await store.putIfAbsent(link);
    }

    const { service } = makeService(store, fakeFileStore());
    const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
    expect(created.link.status).toBe("ACTIVE");

    const reconciledNow = await store.get<ExternalShareLink>(externalShareLinkKey(TENANT, documentId, expiredShareId));
    expect(reconciledNow?.status).toBe("REVOKED");

    const document = await store.get<Document>(documentKey(TENANT, documentId));
    expect(document?.activeExternalShareLinkCount).toBe(5); // 5 preexisting - 1 reconciled + 1 new
  });

  describe("resolveForAnonymousAccess — anti-enumeration (Decision 1/5)", () => {
    it("happy path returns a DTO with a presigned download URL", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const fileStore = fakeFileStore();
      const { service } = makeService(store, fileStore);
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });

      const [, selector, secret] = created.token.split(".");
      const resolved = await service.resolveForAnonymousAccess(`${selector}.${secret}`, { ip: "1.1.1.1" });
      expect(resolved.downloadUrl).toContain("presigned");
      expect(resolved.documentTypeNameSnapshot).toBe("Alvará de Funcionamento");
      expect(fileStore.calls).toBe(1);
    });

    it("malformed token", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { service } = makeService(store, fakeFileStore());
      await expect(service.resolveForAnonymousAccess("not-a-token", { ip: "1.1.1.1" })).rejects.toThrow(ExternalShareLinkInvalidError);
    });

    it("well-formed but nonexistent selector", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { service } = makeService(store, fakeFileStore());
      const fake = `${"a".repeat(32)}.${"b".repeat(64)}`;
      await expect(service.resolveForAnonymousAccess(fake, { ip: "1.1.1.1" })).rejects.toThrow(ExternalShareLinkInvalidError);
    });

    it("wrong secret against a real selector", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
      const [, selector] = created.token.split(".");
      const wrong = `${selector}.${"f".repeat(64)}`;
      await expect(service.resolveForAnonymousAccess(wrong, { ip: "1.1.1.1" })).rejects.toThrow(ExternalShareLinkInvalidError);
    });

    it("expired link", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const past = () => "2026-09-01T00:00:00.000Z";
      const { service } = makeService(store, fakeFileStore(), past);
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
      const [, selector, secret] = created.token.split(".");

      const future = () => "2026-10-01T00:00:00.000Z";
      const { service: laterService } = makeService(store, fakeFileStore(), future);
      await expect(laterService.resolveForAnonymousAccess(`${selector}.${secret}`, { ip: "1.1.1.1" })).rejects.toThrow(ExternalShareLinkInvalidError);
    });

    it("revoked link", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
      await service.revokeShareLink({ tenantId: TENANT, documentId, shareId: created.token.split(".")[0]!, expectedVersion: created.link.version, revokedByUserId: "user-1" });

      const [, selector, secret] = created.token.split(".");
      await expect(service.resolveForAnonymousAccess(`${selector}.${secret}`, { ip: "1.1.1.1" })).rejects.toThrow(ExternalShareLinkInvalidError);
    });

    it("resolution is governed only by the tenantless pointer's own recorded tenantId (never a caller-supplied one)", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
      // resolveForAnonymousAccess() takes NO tenantId parameter at all — the pointer read by
      // selectorHash is the only source of tenantId on this path (see the service's own doc
      // comment). This happy-path resolve proves that end to end.
      const [, selector, secret] = created.token.split(".");
      const resolved = await service.resolveForAnonymousAccess(`${selector}.${secret}`, { ip: "1.1.1.1" });
      expect(resolved.documentTypeNameSnapshot).toBe("Alvará de Funcionamento");
    });

    it("rate-limit exhaustion collapses into the same generic error", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
      const [, selector, secret] = created.token.split(".");
      const token = `${selector}.${secret}`;

      for (let i = 0; i < 30; i++) {
        try {
          await service.resolveForAnonymousAccess(token, { ip: "9.9.9.9" });
        } catch {
          // rate-limit-adjacent single-selector consumption is intentionally exercised, not asserted per-call.
        }
      }
      await expect(service.resolveForAnonymousAccess(token, { ip: "9.9.9.9" })).rejects.toThrow(ExternalShareLinkInvalidError);
    });

    it("tenant not ACTIVE blocks anonymous access even with a valid, unexpired, ACTIVE link", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });

      // Flip tenant to SUSPENDED directly (bypassing executeTenantBusinessMutation, which is not
      // this test's concern) to exercise the anonymous route's own tenant revalidation.
      const lifecycle = await store.get<TenantLifecycleRecord>(tenantLifecycleKey(TENANT));
      const key = tenantLifecycleKey(TENANT);
      (store as unknown as { items: Map<string, unknown> })["items"].set(`${key.PK}#${key.SK}`, { ...(lifecycle as TenantLifecycleRecord), status: "HELD" });

      const [, selector, secret] = created.token.split(".");
      await expect(service.resolveForAnonymousAccess(`${selector}.${secret}`, { ip: "1.1.1.1" })).rejects.toThrow(ExternalShareLinkInvalidError);
    });
  });

  describe("revokeShareLink", () => {
    it("decrements the Document's active counter atomically", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });

      await service.revokeShareLink({ tenantId: TENANT, documentId, shareId: created.token.split(".")[0]!, expectedVersion: created.link.version, revokedByUserId: "user-1" });

      const document = await store.get<Document>(documentKey(TENANT, documentId));
      expect(document?.activeExternalShareLinkCount).toBe(0);
      const link = await store.get<ExternalShareLink>(externalShareLinkKey(TENANT, documentId, created.token.split(".")[0]!));
      expect(link?.status).toBe("REVOKED");
      expect(link?.revokedByUserId).toBe("user-1");
    });

    it("revoking an already-revoked link throws (OCC/status fence)", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      const created = await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
      const shareId = created.token.split(".")[0]!;

      await service.revokeShareLink({ tenantId: TENANT, documentId, shareId, expectedVersion: created.link.version, revokedByUserId: "user-1" });
      await expect(service.revokeShareLink({ tenantId: TENANT, documentId, shareId, expectedVersion: created.link.version, revokedByUserId: "user-1" })).rejects.toThrow();
    });
  });

  describe("listShareLinks", () => {
    it("lists ACTIVE links by document via GSI1", async () => {
      const store = new InMemoryDocumentArchiveStore();
      await seedTenant(store);
      const { documentId } = await seedAcceptedDocument(store);
      const { service } = makeService(store, fakeFileStore());
      await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });
      await service.createShareLink({ tenantId: TENANT, documentId, createdByUserId: "user-1" });

      const page = await service.listShareLinks({ tenantId: TENANT, documentId, status: "ACTIVE" });
      expect(page.items).toHaveLength(2);
    });
  });
});
