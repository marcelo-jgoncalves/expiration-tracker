/**
 * D-218 fatia 3 exit criterion (Roadmap P1 "metadata configurável por Document Type"): the
 * catalog CRUD (D-219) and value-write (D-220) service methods are actually reachable over
 * HTTP, not just unit-tested application-layer methods — same end-to-end-via-real-handlers
 * convention as document-archive-document-type-routes.test.ts. Proves RBAC actually denies a
 * non-ADMIN/non-WRITE caller and a malformed body is rejected with a real 400 (never a 500
 * "Unknown schema $id", the exact bug class D-167's handoff names for a schema registered but
 * never statically imported).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../unit/identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../unit/organization/in-memory-store.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "../unit/document-archive/in-memory-store.js";
import { GlobalUserRepository } from "../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { DocumentArchiveService } from "../../src/modules/document-archive/application/document-archive-service.js";
import { DocumentRequestRecurrenceService } from "../../src/modules/document-archive/application/document-request-recurrence-service.js";
import {
  handleCreateDocumentType,
  handleCreateDocumentTypeMetadataField,
  handleUpdateDocumentTypeMetadataField,
  handleUpdateDocumentMetadataValues,
  type DocumentArchiveHttpDeps,
} from "../../src/modules/document-archive/http/document-archive-handlers.js";
import type { UploadUrlSigner } from "../../src/modules/document/ports/upload-url-signer.js";

function claims(sub: string): ValidatedClaims {
  return { sub, tokenId: `jti-${sub}`, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

let idCounter = 0;
function makeIds() {
  return {
    newDocumentId: () => `doc-${++idCounter}`,
    newVersionId: () => `ver-${++idCounter}`,
    newEventId: () => `evt-${++idCounter}`,
    newRequirementId: () => `req-${++idCounter}`,
    newSeriesId: () => `series-${++idCounter}`,
    newDocumentRequestId: () => `docreq-${++idCounter}`,
    newFileId: () => `file-${++idCounter}`,
    newDocumentTypeId: () => `doctype-${++idCounter}`,
    newRequirementTemplateId: () => "reqtpl_test",
    newRequirementTemplateItemId: () => `reqtplitem_${crypto.randomUUID()}`,
    newDossierExportRunId: () => `dossier_${crypto.randomUUID()}`,
    newDocumentTypeFieldId: () => `doctypefield_${crypto.randomUUID()}`,
    newDocumentTypeFieldOptionId: () => `doctypefieldopt_${crypto.randomUUID()}`,
    newShareId: () => `share_${crypto.randomUUID()}`,
  };
}

const noopSigner: UploadUrlSigner = { presignUpload: async () => ({ uploadUrl: "https://s3.example/unused", requiredHeaders: {} }) };

describe("DocumentType metadata field/value HTTP routes (D-218 fatia 3)", () => {
  let deps: DocumentArchiveHttpDeps;
  let req: { requestId: string; correlationId: string; claims: ValidatedClaims };

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    const resolver = new RequestContextResolver(new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    const store = new InMemoryDocumentArchiveStore();
    const documentArchive = new DocumentArchiveService({ store, tableName: "MainTable", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer: noopSigner, members: { isEligibleMember: async () => true } });
    const recurrence = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds() });
    deps = { resolver, documentArchive, recurrence, quota };

    const bootstrap = await bootstrapWithOrganization(identityStore, organizations, "MainTable", "sub-A");
    await store.putIfAbsent(seedActiveTenantLifecycle(bootstrap.organizationId));
    await store.putIfAbsent(seedActiveTrackedSubject(bootstrap.organizationId, "subj-1"));
    req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
  });

  async function asViewer(): Promise<DocumentArchiveHttpDeps> {
    const realContext = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const viewerContext = { ...realContext, tenant: { ...realContext.tenant, roles: ["VIEWER"] } };
    const fakeResolver = { resolve: async () => viewerContext };
    return { resolver: fakeResolver, documentArchive: deps.documentArchive, recurrence: deps.recurrence, quota: deps.quota } as unknown as DocumentArchiveHttpDeps;
  }

  it("create metadata field -> update (rename/required/optionsPatch) -> write a Document value, all via HTTP handlers", async () => {
    const dt = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Apólice de Seguro" } });
    const documentTypeId = (dt.body["documentType"] as { documentTypeId: string }).documentTypeId;

    const created = await handleCreateDocumentTypeMetadataField(deps, {
      ...req,
      pathParameters: { documentTypeId },
      body: { expectedDocumentTypeVersion: 1, name: "Categoria", valueType: "SINGLE_SELECT", required: false, options: ["Residencial"] },
    });
    expect(created.statusCode).toBe(201);
    const field = (created.body["documentType"] as { metadataFields: Array<{ fieldId: string; options: Array<{ optionId: string }> }> }).metadataFields[0]!;

    const updated = await handleUpdateDocumentTypeMetadataField(deps, {
      ...req,
      pathParameters: { documentTypeId, fieldId: field.fieldId },
      body: { expectedDocumentTypeVersion: 2, name: "Categoria do Imóvel", optionsPatch: [{ op: "ADD", label: "Comercial" }] },
    });
    expect(updated.statusCode).toBe(200);
    const updatedField = (updated.body["documentType"] as { metadataFields: Array<{ name: string; options: unknown[] }> }).metadataFields[0]!;
    expect(updatedField.name).toBe("Categoria do Imóvel");
    expect(updatedField.options).toHaveLength(2);

    const documentArchive = deps.documentArchive;
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const document = await documentArchive.createDocument(context, { subjectId: "subj-1", documentTypeId, hasValidity: false });

    const valueWrite = await handleUpdateDocumentMetadataValues(deps, {
      ...req,
      pathParameters: { documentId: document.documentId },
      body: { expectedDocumentVersion: document.version, values: { [field.fieldId]: { valueType: "SINGLE_SELECT", optionId: field.options[0]!.optionId } } },
    });
    expect(valueWrite.statusCode).toBe(200);
    const writtenDoc = valueWrite.body["document"] as { metadataValues: Record<string, { valueType: string; labelSnapshot: string }> };
    expect(writtenDoc.metadataValues[field.fieldId]).toMatchObject({ valueType: "SINGLE_SELECT", labelSnapshot: "Residencial" });
  });

  it("rejects create-metadata-field with a malformed body (400, not 500 — the schema-registration bug class D-167's handoff names)", async () => {
    const dt = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Apólice" } });
    const documentTypeId = (dt.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const response = await handleCreateDocumentTypeMetadataField(deps, { ...req, pathParameters: { documentTypeId }, body: {} as never });
    expect(response.statusCode).toBe(400);
  });

  it("rejects update-metadata-field with a malformed body (missing expectedDocumentTypeVersion) with 400", async () => {
    const dt = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Apólice" } });
    const documentTypeId = (dt.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const created = await handleCreateDocumentTypeMetadataField(deps, { ...req, pathParameters: { documentTypeId }, body: { expectedDocumentTypeVersion: 1, name: "X", valueType: "TEXT", required: false } });
    const fieldId = (created.body["documentType"] as { metadataFields: Array<{ fieldId: string }> }).metadataFields[0]!.fieldId;
    const response = await handleUpdateDocumentTypeMetadataField(deps, { ...req, pathParameters: { documentTypeId, fieldId }, body: { name: "Y" } as never });
    expect(response.statusCode).toBe(400);
  });

  it("rejects update-metadata-values with a malformed body (values entry missing valueType) with 400", async () => {
    const dt = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Apólice" } });
    const documentTypeId = (dt.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const document = await deps.documentArchive.createDocument(context, { subjectId: "subj-1", documentTypeId, hasValidity: false });
    const response = await handleUpdateDocumentMetadataValues(deps, { ...req, pathParameters: { documentId: document.documentId }, body: { expectedDocumentVersion: document.version, values: { "field-x": { value: "x" } } } as never });
    expect(response.statusCode).toBe(400);
  });

  it("a VIEWER is denied (403) creating and updating a metadata field (ADMIN_ROLES exclusively)", async () => {
    const dt = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Apólice" } });
    const documentTypeId = (dt.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const viewerDeps = await asViewer();

    const createResponse = await handleCreateDocumentTypeMetadataField(viewerDeps, { ...req, pathParameters: { documentTypeId }, body: { expectedDocumentTypeVersion: 1, name: "X", valueType: "TEXT", required: false } });
    expect(createResponse.statusCode).toBe(403);

    const created = await handleCreateDocumentTypeMetadataField(deps, { ...req, pathParameters: { documentTypeId }, body: { expectedDocumentTypeVersion: 1, name: "X", valueType: "TEXT", required: false } });
    const fieldId = (created.body["documentType"] as { metadataFields: Array<{ fieldId: string }> }).metadataFields[0]!.fieldId;
    const updateResponse = await handleUpdateDocumentTypeMetadataField(viewerDeps, { ...req, pathParameters: { documentTypeId, fieldId }, body: { expectedDocumentTypeVersion: 2, name: "Y" } });
    expect(updateResponse.statusCode).toBe(403);
  });

  it("a VIEWER is denied (403) updating Document metadata values (WRITE_ROLES, below VIEWER's tier)", async () => {
    const dt = await handleCreateDocumentType(deps, { ...req, body: { displayName: "Apólice" } });
    const documentTypeId = (dt.body["documentType"] as { documentTypeId: string }).documentTypeId;
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const document = await deps.documentArchive.createDocument(context, { subjectId: "subj-1", documentTypeId, hasValidity: false });
    const viewerDeps = await asViewer();

    const response = await handleUpdateDocumentMetadataValues(viewerDeps, { ...req, pathParameters: { documentId: document.documentId }, body: { expectedDocumentVersion: document.version, values: { "field-x": { valueType: "TEXT", value: "x" } } } });
    expect(response.statusCode).toBe(403);
  });
});
