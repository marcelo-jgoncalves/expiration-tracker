/**
 * D-205 fatia 1 (Roadmap P1 item 16, dossier export) exit criterion: the preview/confirm HTTP
 * routes are actually reachable end-to-end (real RequestContextResolver/bootstrap), same
 * convention as document-archive-document-type-routes.test.ts. `dossier-export.test.ts` already
 * exhaustively covers the service mechanism itself (scopeHash matching/idempotency/RBAC) — this
 * covers the HTTP boundary's own job: a malformed confirm body is rejected with a real 400, and
 * the two routes compose correctly through real context resolution.
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
import { handlePreviewDossierExport, handleConfirmDossierExport, handleDownloadDossierExport, type DocumentArchiveHttpDeps } from "../../src/modules/document-archive/http/document-archive-handlers.js";
import { requirementKey, requirementGsi1Keys } from "../../src/modules/document-archive/domain/requirement.js";
import { dossierExportRunKey, type DossierExportRun } from "../../src/modules/document-archive/domain/dossier-export-run.js";
import type { DossierExportStore } from "../../src/modules/document-archive/ports/dossier-export-store.js";
import type { UploadUrlSigner } from "../../src/modules/document/ports/upload-url-signer.js";
import type { EntityKey } from "../../src/shared/dynamodb/occ.js";

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
  };
}

const noopSigner: UploadUrlSigner = { presignUpload: async () => ({ uploadUrl: "https://s3.example/unused", requiredHeaders: {} }) };

function makeRequirement(tenantId: string, subjectId: string, requirementId: string): Record<string, unknown> & EntityKey {
  const now = "2026-09-06T00:00:00.000Z";
  return {
    ...requirementKey(tenantId, subjectId, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId,
    subjectId,
    name: `req-${requirementId}`,
    applicability: "APPLICABLE",
    status: "MISSING",
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...requirementGsi1Keys(tenantId, "MISSING", now, requirementId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function fakeDossierExportStore(): DossierExportStore {
  return {
    async putPdf() {},
    async putXlsx() {},
    async presignDownload() {
      return "https://example.com/presigned";
    },
  };
}

describe("Dossier export HTTP routes (D-205 fatia 1/3)", () => {
  let deps: DocumentArchiveHttpDeps;
  let store: InMemoryDocumentArchiveStore;
  let req: { requestId: string; correlationId: string; claims: ValidatedClaims };
  let tenantId: string;

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    const resolver = new RequestContextResolver(new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    store = new InMemoryDocumentArchiveStore();
    const documentArchive = new DocumentArchiveService({ store, tableName: "MainTable", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer: noopSigner, members: { isEligibleMember: async () => true } });
    const recurrence = new DocumentRequestRecurrenceService({ store, tableName: "MainTable", ids: makeIds() });
    deps = { resolver, documentArchive, recurrence, quota, dossierExportStore: fakeDossierExportStore() };

    const bootstrap = await bootstrapWithOrganization(identityStore, organizations, "MainTable", "sub-A");
    tenantId = bootstrap.organizationId;
    await store.putIfAbsent(seedActiveTenantLifecycle(tenantId));
    await store.putIfAbsent(seedActiveTrackedSubject(tenantId, "subj-1"));
    await store.putIfAbsent(makeRequirement(tenantId, "subj-1", "req-1"));
    req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
  });

  it("preview -> confirm, end to end via real HTTP handlers", async () => {
    const previewed = await handlePreviewDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1" } });
    expect(previewed.statusCode).toBe(201);
    const run = previewed.body["run"] as { runId: string; scopeHash: string; status: string };
    expect(run.status).toBe("PREVIEW_READY");
    expect(previewed.body["rows"]).toHaveLength(1);

    const confirmed = await handleConfirmDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1", runId: run.runId }, body: { scopeHash: run.scopeHash } });
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.body["run"] as { status: string }).status).toBe("CONFIRMED");
  });

  it("rejects a confirm with a missing scopeHash with a real 400 (never reaching the service)", async () => {
    const previewed = await handlePreviewDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1" } });
    const run = previewed.body["run"] as { runId: string };

    const response = await handleConfirmDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1", runId: run.runId }, body: {} as never });
    expect(response.statusCode).toBe(400);
  });

  it("returns 409 for a confirm whose scopeHash doesn't match", async () => {
    const previewed = await handlePreviewDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1" } });
    const run = previewed.body["run"] as { runId: string };

    const response = await handleConfirmDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1", runId: run.runId }, body: { scopeHash: "wrong" } });
    expect(response.statusCode).toBe(409);
  });

  it("returns 404 for a preview against a Subject that doesn't exist", async () => {
    const response = await handlePreviewDossierExport(deps, { ...req, pathParameters: { subjectId: "nope" } });
    expect(response.statusCode).toBe(404);
  });

  it("denies a VIEWER role with a real 403 (RBAC: docarchive:dossier-export is ADMIN_ROLES exclusively)", async () => {
    const realContext = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
    const viewerContext = { ...realContext, tenant: { ...realContext.tenant, roles: ["VIEWER"] } };
    const fakeResolver = { resolve: async () => viewerContext };
    const viewerDeps = { resolver: fakeResolver, documentArchive: deps.documentArchive, recurrence: deps.recurrence, quota: deps.quota } as unknown as DocumentArchiveHttpDeps;

    const response = await handlePreviewDossierExport(viewerDeps, { ...req, pathParameters: { subjectId: "subj-1" } });
    expect(response.statusCode).toBe(403);
  });

  describe("handleDownloadDossierExport (D-205 fatia 3)", () => {
    async function seedRun(status: DossierExportRun["status"]): Promise<string> {
      const runId = "run-download-1";
      const run: DossierExportRun = {
        ...dossierExportRunKey(tenantId, "subj-1", runId),
        entityType: "DossierExportRun",
        runId,
        subjectId: "subj-1",
        tenantId,
        status,
        requirementIds: ["req-1"],
        scopeHash: "hash",
        createdBy: "user-1",
        version: 1,
        createdAt: "2026-09-06T00:00:00.000Z",
        updatedAt: "2026-09-06T00:00:00.000Z",
      };
      await store.putIfAbsent(run as unknown as Record<string, unknown> & EntityKey);
      return runId;
    }

    it("returns a presigned downloadUrl for a READY run", async () => {
      const runId = await seedRun("READY");
      const response = await handleDownloadDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1", runId }, queryStringParameters: { format: "pdf" } });
      expect(response.statusCode).toBe(200);
      expect(response.body["downloadUrl"]).toBe("https://example.com/presigned");
    });

    it("returns 409 when the run is not READY yet", async () => {
      const runId = await seedRun("GENERATING");
      const response = await handleDownloadDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1", runId }, queryStringParameters: { format: "pdf" } });
      expect(response.statusCode).toBe(409);
    });

    it("returns 400 for an invalid format query parameter", async () => {
      const runId = await seedRun("READY");
      const response = await handleDownloadDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1", runId }, queryStringParameters: { format: "docx" } });
      expect(response.statusCode).toBe(400);
    });

    it("returns 404 for a runId that doesn't exist", async () => {
      const response = await handleDownloadDossierExport(deps, { ...req, pathParameters: { subjectId: "subj-1", runId: "nope" }, queryStringParameters: { format: "pdf" } });
      expect(response.statusCode).toBe(404);
    });

    it("denies a VIEWER role with a real 403 (ADMIN_ROLES exclusively, no recipient fallback)", async () => {
      const runId = await seedRun("READY");
      const realContext = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: undefined });
      const viewerContext = { ...realContext, tenant: { ...realContext.tenant, roles: ["VIEWER"] } };
      const fakeResolver = { resolve: async () => viewerContext };
      const viewerDeps = { resolver: fakeResolver, documentArchive: deps.documentArchive, recurrence: deps.recurrence, quota: deps.quota, dossierExportStore: deps.dossierExportStore } as unknown as DocumentArchiveHttpDeps;

      const response = await handleDownloadDossierExport(viewerDeps, { ...req, pathParameters: { subjectId: "subj-1", runId }, queryStringParameters: { format: "pdf" } });
      expect(response.statusCode).toBe(403);
    });
  });
});
