import { describe, expect, it } from "vitest";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "./in-memory-store.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { requirementKey, requirementGsi1Keys, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";
import { dossierExportRunKey, computeDossierScopeHash, type DossierExportRun } from "../../../src/modules/document-archive/domain/dossier-export-run.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "tenant-1";
const NOW = "2026-09-06T00:00:00.000Z";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["ADMIN"] },
    auth: { issuedAt: NOW, expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
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
    newRequirementTemplateItemId: () => `reqtplitem_${++n}`,
    newDossierExportRunId: () => `dossier-${++n}`,
  };
}

function makeRequirement(subjectId: string, requirementId: string, status: Requirement["status"], opts: { assigneeUserId?: string } = {}): Record<string, unknown> & EntityKey {
  return {
    ...requirementKey(TENANT, subjectId, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId: TENANT,
    subjectId,
    name: `req-${requirementId}`,
    applicability: "APPLICABLE",
    status,
    ...(opts.assigneeUserId !== undefined ? { assigneeUserId: opts.assigneeUserId } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...requirementGsi1Keys(TENANT, status, NOW, requirementId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeService(store: InMemoryDocumentArchiveStore) {
  const signer = { presignUpload: async () => ({ uploadUrl: "https://s3.example/fake?sig=fake", requiredHeaders: {} }) };
  const members = { isEligibleMember: async () => true };
  return new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer, members, now: () => NOW });
}

describe("DocumentArchiveService.previewDossierExport (D-205 fatia 1)", () => {
  it("creates a PREVIEW_READY run, freezing the Subject's current requirementIds, and returns matching preview rows", async () => {
    const store = new InMemoryDocumentArchiveStore([
      seedActiveTenantLifecycle(TENANT),
      seedActiveTrackedSubject(TENANT, "subj-1"),
      makeRequirement("subj-1", "req-1", "MISSING"),
      makeRequirement("subj-1", "req-2", "SATISFIED", { assigneeUserId: "user-9" }),
    ]);
    const { run, rows } = await makeService(store).previewDossierExport(ctx(), "subj-1");

    expect(run.status).toBe("PREVIEW_READY");
    expect(run.subjectId).toBe("subj-1");
    expect([...run.requirementIds].sort()).toEqual(["req-1", "req-2"]);
    expect(run.scopeHash).toBe(computeDossierScopeHash("subj-1", run.requirementIds));
    expect(rows.map((r) => r.requirementId).sort()).toEqual(["req-1", "req-2"]);
    const req2Row = rows.find((r) => r.requirementId === "req-2");
    expect(req2Row?.assigneeUserId).toBe("user-9");

    const persisted = await store.get<DossierExportRun>(dossierExportRunKey(TENANT, "subj-1", run.runId));
    expect(persisted).toEqual(run);
  });

  it("returns an empty requirementIds/rows set for a Subject with no Requirements (never a 404 - the Subject itself exists)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-empty")]);
    const { run, rows } = await makeService(store).previewDossierExport(ctx(), "subj-empty");
    expect(run.requirementIds).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("404s when the Subject itself doesn't exist", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    await expect(makeService(store).previewDossierExport(ctx(), "subj-nonexistent")).rejects.toThrow();
  });

  it("denies a role without ADMIN_ROLES (docarchive:dossier-export, RBAC negative case)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-1")]);
    await expect(makeService(store).previewDossierExport(ctx({ tenant: { tenantId: TENANT, roles: ["MEMBER"] } }), "subj-1")).rejects.toThrow();
  });
});

describe("DocumentArchiveService.confirmDossierExport (D-205 fatia 1, decision 3)", () => {
  async function previewedRun(store: InMemoryDocumentArchiveStore, subjectId = "subj-1") {
    return makeService(store).previewDossierExport(ctx(), subjectId);
  }

  it("transitions PREVIEW_READY -> CONFIRMED and dispatches SQS_DOSSIER_EXPORT_V1 when scopeHash matches", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-1"), makeRequirement("subj-1", "req-1", "MISSING")]);
    const { run } = await previewedRun(store);

    const confirmed = await makeService(store).confirmDossierExport(ctx(), "subj-1", run.runId, run.scopeHash);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toBe(NOW);
    expect(confirmed.version).toBe(run.version + 1);

    const outboxEvents = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]).toMatchObject({ destination: "SQS_DOSSIER_EXPORT_V1", eventType: "DossierExportConfirmed" });
  });

  it("409s when scopeHash does not match the run's own preview-time value", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-1"), makeRequirement("subj-1", "req-1", "MISSING")]);
    const { run } = await previewedRun(store);

    await expect(makeService(store).confirmDossierExport(ctx(), "subj-1", run.runId, "wrong-hash")).rejects.toThrow();
  });

  it("is idempotent: confirming an ALREADY-confirmed run with the SAME scopeHash is a no-op success, never a second outbox dispatch", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-1"), makeRequirement("subj-1", "req-1", "MISSING")]);
    const { run } = await previewedRun(store);

    await makeService(store).confirmDossierExport(ctx(), "subj-1", run.runId, run.scopeHash);
    const secondCall = await makeService(store).confirmDossierExport(ctx(), "subj-1", run.runId, run.scopeHash);
    expect(secondCall.status).toBe("CONFIRMED");

    const outboxEvents = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxEvents).toHaveLength(1); // still just the one from the FIRST confirm.
  });

  it("still 409s a mismatched scopeHash even after the run has already moved past PREVIEW_READY", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-1"), makeRequirement("subj-1", "req-1", "MISSING")]);
    const { run } = await previewedRun(store);
    await makeService(store).confirmDossierExport(ctx(), "subj-1", run.runId, run.scopeHash);

    await expect(makeService(store).confirmDossierExport(ctx(), "subj-1", run.runId, "wrong-hash")).rejects.toThrow();
  });

  it("404s for a runId that doesn't exist", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-1")]);
    await expect(makeService(store).confirmDossierExport(ctx(), "subj-1", "nope", "any-hash")).rejects.toThrow();
  });

  it("denies a role without ADMIN_ROLES (docarchive:dossier-export, RBAC negative case)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, "subj-1"), makeRequirement("subj-1", "req-1", "MISSING")]);
    const { run } = await previewedRun(store);
    await expect(makeService(store).confirmDossierExport(ctx({ tenant: { tenantId: TENANT, roles: ["MEMBER"] } }), "subj-1", run.runId, run.scopeHash)).rejects.toThrow();
  });
});
