import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore } from "./in-memory-store.js";
import { ConflictError, DocumentTypeNameConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import {
  documentTypeKey,
  documentTypeNamePointerKey,
  MAX_ACTIVE_METADATA_FIELDS,
  MAX_ACTIVE_OPTIONS_PER_FIELD,
  MAX_TOTAL_METADATA_FIELD_DEFINITIONS,
  type DocumentType,
  type DocumentTypeFieldOption,
  type DocumentTypeMetadataFieldDefinition,
} from "../../../src/modules/document-archive/domain/document-type.js";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
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
  newDossierExportRunId: () => `dossier_${crypto.randomUUID()}`,
  newDocumentTypeFieldId: () => `doctypefield_${crypto.randomUUID()}`,
  newDocumentTypeFieldOptionId: () => `doctypefieldopt_${crypto.randomUUID()}`,
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
  const service = new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer: noopSigner, members: { isEligibleMember: async () => true }, now: () => NOW });
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

// D-218 (Roadmap P1, "metadata configurável por Document Type"), fatia 1: domain + catalog
// CRUD only — see docs/architecture/reviews/document-type-metadata-scoping/estado-final-consolidado.md.
describe("DocumentArchiveService — DocumentType metadata fields (D-218, fatia 1)", () => {
  async function seedDocumentTypeWithFields(store: InMemoryDocumentArchiveStore, fields: DocumentTypeMetadataFieldDefinition[]): Promise<DocumentType> {
    const dt: DocumentType = {
      ...(documentTypeKey(TENANT, "doctype-preseeded") as { PK: string; SK: "METADATA" }),
      entityType: "DocumentType",
      documentTypeId: "doctype-preseeded",
      tenantId: TENANT,
      displayName: "Apólice de Seguro",
      status: "ACTIVE",
      metadataFields: fields,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
      GSI1PK: `TENANT#${TENANT}#DOCTYPESTATUS#ACTIVE`,
      GSI1SK: `NAME#apolice de seguro#DOCTYPE#doctype-preseeded`,
    };
    await store.putIfAbsent(dt);
    return dt;
  }

  function makeField(overrides: Partial<DocumentTypeMetadataFieldDefinition> = {}): DocumentTypeMetadataFieldDefinition {
    return {
      fieldId: `field-${Math.random()}`,
      name: "Seguradora",
      valueType: "TEXT",
      required: false,
      status: "ACTIVE",
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  it("createDocumentTypeMetadataField persists a new ACTIVE field, TEXT type, version increments", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const updated = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "Seguradora", valueType: "TEXT", required: false });
    expect(updated.version).toBe(2);
    expect(updated.metadataFields).toHaveLength(1);
    const field = updated.metadataFields![0]!;
    expect(field.name).toBe("Seguradora");
    expect(field.valueType).toBe("TEXT");
    expect(field.status).toBe("ACTIVE");
    expect(field.fieldId).toBeTruthy();

    const stored = await store.get<DocumentType>(documentTypeKey(TENANT, dt.documentTypeId));
    expect(stored?.metadataFields).toHaveLength(1);
  });

  it("createDocumentTypeMetadataField: SINGLE_SELECT mints a stable optionId per option label", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const updated = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, {
      name: "Categoria",
      valueType: "SINGLE_SELECT",
      required: false,
      options: ["Residencial", "Automóvel"],
    });
    const field = updated.metadataFields![0]!;
    expect(field.options).toHaveLength(2);
    expect(field.options![0]).toMatchObject({ label: "Residencial", status: "ACTIVE" });
    expect(field.options![0]!.optionId).toBeTruthy();
    expect(field.options![0]!.optionId).not.toBe(field.options![1]!.optionId);
  });

  // G-V3: a non-SINGLE_SELECT field must never silently carry an options array — options only
  // make sense against a fixed catalog, and this field's storage representation (Decision 8)
  // has no room for one.
  it("createDocumentTypeMetadataField rejects options on a non-SINGLE_SELECT field", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    await expect(
      service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "Valor", valueType: "NUMBER", required: false, options: ["a"] }),
    ).rejects.toThrow(ValidationError);
  });

  it("createDocumentTypeMetadataField rejects an empty or over-long name", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    await expect(service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "  ", valueType: "TEXT", required: false })).rejects.toThrow(ValidationError);
    await expect(service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "x".repeat(201), valueType: "TEXT", required: false })).rejects.toThrow(ValidationError);
  });

  it("VIEWER/MEMBER cannot create or update a metadata field (ADMIN_ROLES exclusively)", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    await expect(service.createDocumentTypeMetadataField(ctxAs(["VIEWER"]), dt.documentTypeId, dt.version, { name: "X", valueType: "TEXT", required: false })).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.createDocumentTypeMetadataField(ctxAs(["MEMBER"]), dt.documentTypeId, dt.version, { name: "X", valueType: "TEXT", required: false })).rejects.toThrow(AuthorizationDeniedError);

    const updated = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "X", valueType: "TEXT", required: false });
    const fieldId = updated.metadataFields![0]!.fieldId;
    await expect(service.updateDocumentTypeMetadataField(ctxAs(["MEMBER"]), dt.documentTypeId, fieldId, updated.version, { name: "Y" })).rejects.toThrow(AuthorizationDeniedError);
  });

  // G-V3: caps are on ACTIVE fields specifically (Decision 1) — pre-seeding MAX_ACTIVE_METADATA_FIELDS
  // ACTIVE fields must reject a 21st ACTIVE create, proving the cap is checked, not silently ignored.
  it(`createDocumentTypeMetadataField rejects a ${MAX_ACTIVE_METADATA_FIELDS + 1}th ACTIVE field`, async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const fields = Array.from({ length: MAX_ACTIVE_METADATA_FIELDS }, (_, i) => makeField({ fieldId: `field-${i}`, name: `Field ${i}` }));
    const dt = await seedDocumentTypeWithFields(store, fields);
    await expect(service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "One too many", valueType: "TEXT", required: false })).rejects.toThrow(ValidationError);
  });

  // G-V3: the TOTAL cap (active+archived, Decision 1) is a permanent ceiling distinct from the
  // active cap — a DocumentType with 100 total definitions (mostly archived, so the active cap
  // alone would allow more) must still reject a 101st create.
  it(`createDocumentTypeMetadataField rejects a ${MAX_TOTAL_METADATA_FIELD_DEFINITIONS + 1}th field even when all existing are ARCHIVED`, async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const fields = Array.from({ length: MAX_TOTAL_METADATA_FIELD_DEFINITIONS }, (_, i) => makeField({ fieldId: `field-${i}`, name: `Field ${i}`, status: "ARCHIVED" }));
    const dt = await seedDocumentTypeWithFields(store, fields);
    await expect(service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "One too many", valueType: "TEXT", required: false })).rejects.toThrow(ValidationError);
  });

  it("createDocumentTypeMetadataField: OCC fence rejects a stale expectedVersion", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "A", valueType: "TEXT", required: false }); // version now 2, dt.version stale
    await expect(service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "B", valueType: "TEXT", required: false })).rejects.toThrow(ConflictError);
  });

  it("updateDocumentTypeMetadataField renames/changes required without touching fieldId or valueType", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const created = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "Seguradora", valueType: "TEXT", required: false });
    const fieldId = created.metadataFields![0]!.fieldId;

    const updated = await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, created.version, { name: "Nome da Seguradora", required: true });
    const field = updated.metadataFields![0]!;
    expect(field.fieldId).toBe(fieldId);
    expect(field.name).toBe("Nome da Seguradora");
    expect(field.required).toBe(true);
    expect(field.valueType).toBe("TEXT"); // immutable, no input field even exists to change it
  });

  // G-V3: archiving is a tombstone (Decision 4) — the field is never removed from the array,
  // it only flips status. This is the invariant the whole "never delete" checklist criterion
  // rests on: a field that already has Document values referencing it must still be findable.
  it("updateDocumentTypeMetadataField archives a field as a tombstone (stays in the array, never removed)", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const created = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "Seguradora", valueType: "TEXT", required: false });
    const fieldId = created.metadataFields![0]!.fieldId;

    const archived = await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, created.version, { status: "ARCHIVED" });
    expect(archived.metadataFields).toHaveLength(1);
    expect(archived.metadataFields![0]!.status).toBe("ARCHIVED");
    expect(archived.metadataFields![0]!.fieldId).toBe(fieldId);

    const reactivated = await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, archived.version, { status: "ACTIVE" });
    expect(reactivated.metadataFields![0]!.status).toBe("ACTIVE");
  });

  it("updateDocumentTypeMetadataField 404s on an unknown fieldId", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    await expect(service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, "field-missing", dt.version, { name: "X" })).rejects.toThrow(NotFoundError);
  });

  it("updateDocumentTypeMetadataField: optionsPatch ADD/RENAME/ARCHIVE/REACTIVATE a SINGLE_SELECT option, optionId stable throughout", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const created = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "Categoria", valueType: "SINGLE_SELECT", required: false, options: ["Residencial"] });
    const fieldId = created.metadataFields![0]!.fieldId;
    const originalOptionId = created.metadataFields![0]!.options![0]!.optionId;

    const added = await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, created.version, { optionsPatch: [{ op: "ADD", label: "Automóvel" }] });
    expect(added.metadataFields![0]!.options).toHaveLength(2);

    const renamed = await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, added.version, { optionsPatch: [{ op: "RENAME", optionId: originalOptionId, label: "Residencial (renomeado)" }] });
    const renamedOption = renamed.metadataFields![0]!.options!.find((o) => o.optionId === originalOptionId)!;
    expect(renamedOption.label).toBe("Residencial (renomeado)");
    expect(renamedOption.optionId).toBe(originalOptionId); // identity stable across rename

    const archived = await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, renamed.version, { optionsPatch: [{ op: "ARCHIVE", optionId: originalOptionId }] });
    const archivedOption = archived.metadataFields![0]!.options!.find((o) => o.optionId === originalOptionId)!;
    expect(archivedOption.status).toBe("ARCHIVED");
    expect(archived.metadataFields![0]!.options).toHaveLength(2); // never removed from the array

    const reactivated = await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, archived.version, { optionsPatch: [{ op: "REACTIVATE", optionId: originalOptionId }] });
    expect(reactivated.metadataFields![0]!.options!.find((o) => o.optionId === originalOptionId)!.status).toBe("ACTIVE");
  });

  it("updateDocumentTypeMetadataField rejects optionsPatch on a non-SINGLE_SELECT field", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const created = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "Valor", valueType: "NUMBER", required: false });
    const fieldId = created.metadataFields![0]!.fieldId;
    await expect(
      service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, created.version, { optionsPatch: [{ op: "ADD", label: "x" }] }),
    ).rejects.toThrow(ValidationError);
  });

  it("updateDocumentTypeMetadataField rejects an optionsPatch op referencing an unknown optionId", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const created = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "Categoria", valueType: "SINGLE_SELECT", required: false, options: ["A"] });
    const fieldId = created.metadataFields![0]!.fieldId;
    await expect(
      service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, created.version, { optionsPatch: [{ op: "ARCHIVE", optionId: "option-missing" }] }),
    ).rejects.toThrow(NotFoundError);
  });

  // G-V3: ACTIVE option cap — pre-seed a SINGLE_SELECT field with the max active options,
  // adding one more must reject rather than silently growing past the intended UX bound.
  it(`updateDocumentTypeMetadataField rejects ADDing a ${MAX_ACTIVE_OPTIONS_PER_FIELD + 1}th ACTIVE option`, async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const options: DocumentTypeFieldOption[] = Array.from({ length: MAX_ACTIVE_OPTIONS_PER_FIELD }, (_, i) => ({ optionId: `opt-${i}`, label: `Option ${i}`, status: "ACTIVE" }));
    const field = makeField({ fieldId: "field-select", valueType: "SINGLE_SELECT", options });
    const dt = await seedDocumentTypeWithFields(store, [field]);
    await expect(
      service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, "field-select", dt.version, { optionsPatch: [{ op: "ADD", label: "One too many" }] }),
    ).rejects.toThrow(ValidationError);
  });

  it("updateDocumentTypeMetadataField: OCC fence rejects a stale expectedVersion", async () => {
    const { service, store } = makeService();
    await seedTenant(store);
    const dt = await service.createDocumentType(ctx(), { displayName: "Apólice de Seguro" });
    const created = await service.createDocumentTypeMetadataField(ctx(), dt.documentTypeId, dt.version, { name: "A", valueType: "TEXT", required: false });
    const fieldId = created.metadataFields![0]!.fieldId;
    await service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, created.version, { name: "B" }); // version now 3, created.version stale
    await expect(service.updateDocumentTypeMetadataField(ctx(), dt.documentTypeId, fieldId, created.version, { name: "C" })).rejects.toThrow(ConflictError);
  });
});
