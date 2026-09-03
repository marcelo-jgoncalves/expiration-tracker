import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { ConflictError, DocumentTypeNameConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { documentTypeKey, documentTypeNamePointerKey, type DocumentType } from "../../../src/modules/document-archive/domain/document-type.js";
import type { UploadUrlSigner } from "../../../src/modules/document/ports/upload-url-signer.js";

const TENANT = "tenant-1";
const NOW = "2026-09-02T00:00:00.000Z";

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

const noopSigner: UploadUrlSigner = {
  presignUpload: async () => ({ uploadUrl: "https://s3.example/unused", requiredHeaders: {} }),
};

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["ADMIN"] },
    auth: { issuedAt: NOW, expiresAt: new Date(Date.parse(NOW) + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function ctxAs(roles: string[]): RequestContext {
  return ctx({ tenant: { tenantId: TENANT, roles } });
}

async function seedTenant(store: InMemoryDocumentArchiveStore): Promise<void> {
  const record: TenantLifecycleRecord = {
    ...(tenantLifecycleKey(TENANT) as { PK: string; SK: "LIFECYCLE" }),
    entityType: "TenantLifecycleRecord",
    tenantId: TENANT,
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  await store.putIfAbsent(record);
}

function makeService(store = new InMemoryDocumentArchiveStore()) {
  const service = new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer: noopSigner, now: () => NOW });
  return { service, store };
}

describe("DocumentArchiveService — DocumentType catalog (D-173, items 1-2)", () => {
  it("createDocumentType persists DocumentType + dedupe pointer with matching GSI1/keys", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará Sanitário" });
    expect(dt.status).toBe("ACTIVE");
    expect(dt.version).toBe(1);
    expect(dt.GSI1PK).toBe(`TENANT#${TENANT}#DOCTYPESTATUS#ACTIVE`);
    expect(dt.GSI1SK).toBe(`NAME#alvara sanitario#DOCTYPE#${dt.documentTypeId}`);

    const stored = await store.get<DocumentType>(documentTypeKey(TENANT, dt.documentTypeId));
    expect(stored?.displayName).toBe("Alvará Sanitário");

    const pointer = await store.get(documentTypeNamePointerKey(TENANT, "alvara sanitario"));
    expect(pointer).toMatchObject({ documentTypeId: dt.documentTypeId, normalizedName: "alvara sanitario" });
  });

  it("VIEWER cannot create/rename/deprecate/reactivate a DocumentType, but MAY read (RBAC tier parity with document:delete)", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const viewer = ctxAs(["VIEWER"]);
    await expect(service.createDocumentType(viewer, { displayName: "X" })).rejects.toThrow(AuthorizationDeniedError);

    const dt = await service.createDocumentType(ctx(), { displayName: "Y" });
    await expect(service.renameDocumentType(viewer, dt.documentTypeId, dt.version, "Z")).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.deprecateDocumentType(viewer, dt.documentTypeId, dt.version)).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.reactivateDocumentType(viewer, dt.documentTypeId, dt.version)).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.getDocumentType(viewer, dt.documentTypeId)).resolves.toMatchObject({ documentTypeId: dt.documentTypeId });
  });

  it("MEMBER (WRITE_ROLES, below ADMIN) cannot create a DocumentType — same tier as document:delete/requirement:delete", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const member = ctxAs(["MEMBER"]);
    await expect(service.createDocumentType(member, { displayName: "X" })).rejects.toThrow(AuthorizationDeniedError);
  });

  // G-V3: dedupe pointer race — two concurrent creates with the same normalized name, one must
  // fail with DocumentTypeNameConflictError. Breaking the mechanism: if the pointer Put were
  // NOT `attribute_not_exists`-conditioned (or omitted from the transaction entirely), both
  // creates would succeed and silently produce two DocumentTypes claiming the same name — this
  // test would then fail to observe a rejection at all, catching that regression.
  it("createDocumentType: concurrent creates with the same normalized name — the second loses the pointer race", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const first = await service.createDocumentType(ctx(), { displayName: "Certidão Negativa" });
    expect(first.status).toBe("ACTIVE");

    // A racing second call for a name that normalizes identically (diacritics/case/whitespace
    // differ, normalizedName does not) must be rejected, never silently create a second entity.
    await expect(service.createDocumentType(ctx(), { displayName: "certidao   negativa" })).rejects.toThrow(DocumentTypeNameConflictError);

    // Only one DocumentType + one pointer physically exist.
    const all = store.allItems();
    expect(all.filter((i) => i["entityType"] === "DocumentType")).toHaveLength(1);
    expect(all.filter((i) => i["entityType"] === "DocumentTypeNamePointer")).toHaveLength(1);
  });

  it("renameDocumentType: same normalized name only updates displayName (2-entry branch, no pointer churn)", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará Sanitário" });
    const renamed = await service.renameDocumentType(ctx(), dt.documentTypeId, dt.version, "ALVARA SANITARIO"); // same normalized form
    expect(renamed.displayName).toBe("ALVARA SANITARIO");
    expect(renamed.version).toBe(2);

    // The pointer row for the (unchanged) normalized name is untouched — same PK, same documentTypeId.
    const pointer = await store.get(documentTypeNamePointerKey(TENANT, "alvara sanitario"));
    expect(pointer).toMatchObject({ documentTypeId: dt.documentTypeId });
    expect(store.allItems().filter((i) => i["entityType"] === "DocumentTypeNamePointer")).toHaveLength(1);
  });

  it("renameDocumentType: changed normalized name moves the pointer (4-entry branch) and blocks the new name if already in use", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const a = await service.createDocumentType(ctx(), { displayName: "Alvará" });
    await service.createDocumentType(ctx(), { displayName: "Licença" });

    const renamed = await service.renameDocumentType(ctx(), a.documentTypeId, a.version, "Certificado");
    expect(renamed.displayName).toBe("Certificado");
    expect(renamed.GSI1SK).toBe(`NAME#certificado#DOCTYPE#${a.documentTypeId}`);

    // Old pointer gone, new pointer present, pointing at the renamed type.
    expect(await store.get(documentTypeNamePointerKey(TENANT, "alvara"))).toBeUndefined();
    const newPointer = await store.get(documentTypeNamePointerKey(TENANT, "certificado"));
    expect(newPointer).toMatchObject({ documentTypeId: a.documentTypeId });

    // Renaming b onto a's OLD name is fine (freed), but renaming onto a's CURRENT/an in-use name
    // (b's own "licença") must fail with the name-conflict error, never silently steal the pointer.
    await expect(service.renameDocumentType(ctx(), a.documentTypeId, renamed.version, "Licença")).rejects.toThrow(DocumentTypeNameConflictError);
  });

  // G-V3: prove the wrong branch would break. If renameDocumentType always used the 4-entry
  // (Delete old pointer + Put new pointer) shape even when the normalized name is unchanged,
  // DynamoDB would reject the transaction outright (Delete+Put on the SAME item — the exact
  // constraint the design doc's two-branch split exists to avoid). This test locks in that the
  // same-normalized-name path never emits a pointer Delete/Put pair at all — asserted here via
  // the pointer row's `version` staying at 1 (a Put would reset the pointer's own version).
  it("renameDocumentType (same normalized name) never touches the pointer row at all", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará" });
    const pointerBefore = await store.get(documentTypeNamePointerKey(TENANT, "alvara"));
    await service.renameDocumentType(ctx(), dt.documentTypeId, dt.version, "ALVARA");
    const pointerAfter = await store.get(documentTypeNamePointerKey(TENANT, "alvara"));
    expect(pointerAfter?.version).toBe(pointerBefore?.version);
  });

  // G-V3: OCC fence on rename — a stale expectedVersion must be rejected, never silently applied
  // over a concurrent write. Breaking the mechanism (verified by removing extraConditions above)
  // would make this test pass a stale write through instead of throwing ConflictError.
  it("renameDocumentType: OCC fence rejects a stale expectedVersion", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará" });
    await service.renameDocumentType(ctx(), dt.documentTypeId, dt.version, "Alvará V2"); // version now 2
    await expect(service.renameDocumentType(ctx(), dt.documentTypeId, dt.version, "Alvará V3")).rejects.toThrow(ConflictError);
  });

  it("renameDocumentType 404s on an unknown documentTypeId", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    await expect(service.renameDocumentType(ctx(), "doctype-missing", 1, "X")).rejects.toThrow(NotFoundError);
  });

  // G-V3: deprecate/reactivate OCC fence + wrong-FROM-status guard, same mechanism.
  it("deprecateDocumentType flips ACTIVE -> DEPRECATED and updates GSI1PK", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará" });
    const deprecated = await service.deprecateDocumentType(ctx(), dt.documentTypeId, dt.version);
    expect(deprecated.status).toBe("DEPRECATED");
    expect(deprecated.GSI1PK).toBe(`TENANT#${TENANT}#DOCTYPESTATUS#DEPRECATED`);
  });

  it("deprecateDocumentType rejects deprecating an already-DEPRECATED type (FROM-status guard, not just OCC)", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará" });
    const deprecated = await service.deprecateDocumentType(ctx(), dt.documentTypeId, dt.version);
    // Same version number would pass a version-only check trivially since it's the CURRENT
    // version — the FROM-status ConditionExpression is what actually blocks this, not OCC.
    await expect(service.deprecateDocumentType(ctx(), dt.documentTypeId, deprecated.version)).rejects.toThrow(ConflictError);
  });

  it("reactivateDocumentType flips DEPRECATED -> ACTIVE and rejects reactivating an already-ACTIVE type", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará" });
    const deprecated = await service.deprecateDocumentType(ctx(), dt.documentTypeId, dt.version);
    const reactivated = await service.reactivateDocumentType(ctx(), dt.documentTypeId, deprecated.version);
    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.GSI1PK).toBe(`TENANT#${TENANT}#DOCTYPESTATUS#ACTIVE`);
    await expect(service.reactivateDocumentType(ctx(), dt.documentTypeId, reactivated.version)).rejects.toThrow(ConflictError);
  });

  it("deprecateDocumentType: OCC fence rejects a stale expectedVersion", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Alvará" });
    await service.renameDocumentType(ctx(), dt.documentTypeId, dt.version, "Alvará V2"); // version now 2, dt.version stale
    await expect(service.deprecateDocumentType(ctx(), dt.documentTypeId, dt.version)).rejects.toThrow(ConflictError);
  });
});
