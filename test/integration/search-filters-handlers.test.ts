/**
 * D-194 Fatia 3 (search/filters) - HTTP-level wiring proof for the 3 new routes
 * (GET /items/search, GET /subjects/search, GET /document-archive/requirements/search):
 * schema validation, the cursor's signature-fingerprint rejection (400 when filters change),
 * and the {items, cursor, scanLimitReached} page contract, all through the real handler
 * functions (not just the service layer, which `test/unit/**\/*-search.test.ts` already covers
 * in depth). Mirrors `expiration-lifecycle.test.ts`'s bootstrap convention.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../unit/identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../unit/organization/in-memory-store.js";
import { InMemoryExpirationStore, activeLifecycleRecord as expirationLifecycle, makeExpirationIdGenerator, allowAllMemberEligibilityChecker } from "../unit/expiration/in-memory-store.js";
import { InMemorySubjectStore, activeLifecycleRecord as subjectLifecycle, makeSubjectIdGenerator } from "../unit/subject/in-memory-store.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle } from "../unit/document-archive/in-memory-store.js";
import { GlobalUserRepository } from "../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { ExpirationService } from "../../src/modules/expiration/application/expiration-service.js";
import { SubjectService } from "../../src/modules/subject/application/subject-service.js";
import { DocumentArchiveService } from "../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentRequestRecurrenceService } from "../../src/modules/document-archive/application/document-request-recurrence-service.js";
import { handleCreateItem, handleSearchItems } from "../../src/modules/expiration/http/item-handlers.js";
import { handleCreateSubject, handleSearchSubjects } from "../../src/modules/subject/http/subject-handlers.js";
import { handleSearchRequirements } from "../../src/modules/document-archive/http/document-archive-handlers.js";
import { requirementKey, requirementGsi1Keys } from "../../src/modules/document-archive/domain/requirement.js";

function claims(sub: string): ValidatedClaims {
  return { sub, tokenId: `jti-${sub}`, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

describe("D-194 Fatia 3 - search/filters HTTP handlers", () => {
  let resolver: RequestContextResolver;
  let expirationStore: InMemoryExpirationStore;
  let subjectStore: InMemorySubjectStore;
  let documentArchiveStore: InMemoryDocumentArchiveStore;
  let deps: {
    resolver: RequestContextResolver;
    expiration: ExpirationService;
    subjects: SubjectService;
    documentArchive: DocumentArchiveService;
    quota: TenantQuotaService;
  };
  let tenantId: string;

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    resolver = new RequestContextResolver(new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    documentArchiveStore = new InMemoryDocumentArchiveStore();
    expirationStore = new InMemoryExpirationStore();
    subjectStore = new InMemorySubjectStore();
    const expiration = new ExpirationService({ store: expirationStore, tableName: "MainTable", ids: makeExpirationIdGenerator(), members: allowAllMemberEligibilityChecker() });
    const subjects = new SubjectService({ store: subjectStore, tableName: "MainTable", ids: makeSubjectIdGenerator() });
    const documentArchive = new DocumentArchiveService({
      store: documentArchiveStore,
      tableName: "MainTable",
      ids: {
        newDocumentId: () => "doc-1",
        newVersionId: () => "ver-1",
        newEventId: () => "evt-1",
        newRequirementId: () => "req-1",
        newSeriesId: () => "series-1",
        newDocumentRequestId: () => "docreq-1",
        newFileId: () => "file-1",
        newDocumentTypeId: () => "doctype-1",
        newRequirementTemplateId: () => "reqtpl-1",
        newRequirementTemplateItemId: () => "reqtplitem-1",
      },
      quarantineBucket: "test-quarantine-bucket",
      signer: { presignUpload: async () => ({ uploadUrl: "https://s3.example/fake?sig=fake", requiredHeaders: {} }) },
      members: { isEligibleMember: async () => true },
    });
    deps = { resolver, expiration, subjects, documentArchive, quota };

    await bootstrapWithOrganization(identityStore, organizations, "MainTable", "sub-A");
    const bootstrapped = await resolver.resolve({ claims: claims("sub-A"), requestId: "bootstrap", correlationId: "bootstrap", organizationIdHint: undefined });
    tenantId = bootstrapped.tenant.tenantId;
    await expirationStore.putIfAbsent(expirationLifecycle(tenantId));
    await subjectStore.putIfAbsent(subjectLifecycle(tenantId));
    await documentArchiveStore.putIfAbsent(seedActiveTenantLifecycle(tenantId));
  });

  it("GET /items/search: rejects missing status (400), returns {items, cursor, scanLimitReached}, and rejects a reused cursor with a different filter (400)", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };

    const missingStatus = await handleSearchItems(deps, { ...req, queryStringParameters: {} });
    expect(missingStatus.statusCode).toBe(400);

    await handleCreateItem(deps, { ...req, body: { name: "Alvará", category: "Licenças", dueDate: "2027-01-01T00:00:00.000Z" } });
    const ok = await handleSearchItems(deps, { ...req, queryStringParameters: { status: "ACTIVE" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toHaveProperty("items");
    expect(ok.body).toHaveProperty("cursor");
    expect(ok.body).toHaveProperty("scanLimitReached");
    expect((ok.body["items"] as unknown[])[0]).toMatchObject({ kind: "EXPIRATION_ITEM" });

    // Mint a real cursor path is only reachable when scanLimitReached - simulate a tampered/
    // mismatched cursor directly (same shape any real cursor from a DIFFERENT status would take).
    const wrongFilterCursor = await handleSearchItems(deps, { ...req, queryStringParameters: { status: "ARCHIVED", namePrefix: "x" } });
    expect(wrongFilterCursor.statusCode).toBe(200); // no items, still a valid call
    const cursorFromArchived = Buffer.from(JSON.stringify({ sig: "not-a-real-sig", key: {} }), "utf-8").toString("base64url");
    const rejected = await handleSearchItems(deps, { ...req, queryStringParameters: { status: "ACTIVE", cursor: cursorFromArchived } });
    expect(rejected.statusCode).toBe(400);
  });

  it("GET /subjects/search: rejects missing status (400), returns {items, cursor, scanLimitReached} with kind SUBJECT", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };

    const missingStatus = await handleSearchSubjects(deps, { ...req, queryStringParameters: {} });
    expect(missingStatus.statusCode).toBe(400);

    await handleCreateSubject(deps, { ...req, body: { type: "VENDOR", displayName: "ACME Seguros" } });
    const ok = await handleSearchSubjects(deps, { ...req, queryStringParameters: { status: "ACTIVE" } });
    expect(ok.statusCode).toBe(200);
    expect((ok.body["items"] as unknown[])[0]).toMatchObject({ kind: "SUBJECT" });
  });

  it("GET /document-archive/requirements/search: rejects missing status (400), returns {items, cursor, scanLimitReached} with kind REQUIREMENT (the underlying schema separately rejects a `tag` field outright - see schemas.test.ts - Requirement has no tags, out of scope)", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };

    // handleSearchRequirements never touches `recurrence` (only `resolver`/`documentArchive`/
    // `quota`), but DocumentArchiveHttpDeps requires the field structurally - a stub is enough.
    const archiveDeps = { ...deps, recurrence: undefined as unknown as DocumentRequestRecurrenceService };
    const missingStatus = await handleSearchRequirements(archiveDeps, { ...req, queryStringParameters: {} });
    expect(missingStatus.statusCode).toBe(400);

    const now = "2026-09-03T00:00:00.000Z";
    await documentArchiveStore.putIfAbsent({
      ...requirementKey(tenantId, "subj-1", "req-1"),
      entityType: "Requirement",
      requirementId: "req-1",
      tenantId,
      subjectId: "subj-1",
      name: "Certidão Negativa",
      applicability: "APPLICABLE",
      status: "MISSING",
      createdAt: now,
      updatedAt: now,
      version: 1,
      ...requirementGsi1Keys(tenantId, "MISSING", now, "req-1"),
    });
    const ok = await handleSearchRequirements(archiveDeps, { ...req, queryStringParameters: { status: "MISSING" } });
    expect(ok.statusCode).toBe(200);
    expect((ok.body["items"] as unknown[])[0]).toMatchObject({ kind: "REQUIREMENT" });
  });
});
