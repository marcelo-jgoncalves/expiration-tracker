import { describe, expect, it } from "vitest";
import { InMemoryDocumentArchiveStore, seedActiveTenantLifecycle, seedActiveTrackedSubject } from "./in-memory-store.js";
import { DocumentArchiveService } from "../../../src/modules/document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";
import { dossierExportRunKey, type DossierExportRun } from "../../../src/modules/document-archive/domain/dossier-export-run.js";
import { requirementKey, requirementGsi1Keys } from "../../../src/modules/document-archive/domain/requirement.js";
import { processDossierExportGeneration, MAX_DOSSIER_REQUIREMENTS, type DossierExportGenerationDeps } from "../../../src/workers/dossier-export/generate.js";
import type { DossierExportStore } from "../../../src/modules/document-archive/ports/dossier-export-store.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "tenant-1";
const SUBJECT = "subj-1";
const RUN_ID = "run-1";
const NOW = "2026-09-06T10:00:00.000Z";

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
    newDocumentTypeFieldId: () => `doctypefield_${++n}`,
    newDocumentTypeFieldOptionId: () => `doctypefieldopt_${++n}`,
  };
}

function makeRequirement(requirementId: string): Record<string, unknown> & EntityKey {
  return {
    ...requirementKey(TENANT, SUBJECT, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId: TENANT,
    subjectId: SUBJECT,
    name: `req-${requirementId}`,
    applicability: "APPLICABLE",
    status: "MISSING",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...requirementGsi1Keys(TENANT, "MISSING", NOW, requirementId),
  } as unknown as Record<string, unknown> & EntityKey;
}

function makeRun(overrides: Partial<DossierExportRun> = {}): DossierExportRun {
  const requirementIds = overrides.requirementIds ?? ["req-1", "req-2"];
  return {
    ...dossierExportRunKey(TENANT, SUBJECT, RUN_ID),
    entityType: "DossierExportRun",
    runId: RUN_ID,
    subjectId: SUBJECT,
    tenantId: TENANT,
    status: "CONFIRMED",
    requirementIds,
    scopeHash: "hash",
    createdBy: "user-1",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    confirmedAt: NOW,
    ...overrides,
  };
}

function makeExportStore(): DossierExportStore & { pdfCalls: unknown[]; xlsxCalls: unknown[] } {
  const pdfCalls: unknown[] = [];
  const xlsxCalls: unknown[] = [];
  return {
    pdfCalls,
    xlsxCalls,
    async putPdf(input) {
      pdfCalls.push(input);
    },
    async putXlsx(input) {
      xlsxCalls.push(input);
    },
    async presignDownload() {
      return "https://example.com/presigned";
    },
  };
}

function makeDeps(store: InMemoryDocumentArchiveStore, exportStore: DossierExportStore): DossierExportGenerationDeps {
  const signer = { presignUpload: async () => ({ uploadUrl: "https://s3.example/fake?sig=fake", requiredHeaders: {} }) };
  const members = { isEligibleMember: async () => true };
  const documentArchive = new DocumentArchiveService({ store, tableName: "test-table", ids: makeIds(), quarantineBucket: "test-quarantine-bucket", signer, members, now: () => NOW });
  return { store, tableName: "test-table", documentArchive, exportStore, now: () => NOW };
}

describe("processDossierExportGeneration (D-205 fatia 2)", () => {
  it("happy path: CONFIRMED -> GENERATING -> READY, uploads both PDF and XLSX", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), makeRequirement("req-1"), makeRequirement("req-2")]);
    await store.transactWrite([{ Put: { TableName: "test-table", Item: makeRun() as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore = makeExportStore();
    const deps = makeDeps(store, exportStore);

    const result = await processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: RUN_ID });

    expect(result).toEqual({ kind: "READY", requirementCount: 2 });
    expect(exportStore.pdfCalls).toHaveLength(1);
    expect(exportStore.xlsxCalls).toHaveLength(1);
    const finalRun = await store.get<DossierExportRun>(dossierExportRunKey(TENANT, SUBJECT, RUN_ID));
    expect(finalRun?.status).toBe("READY");
    expect(finalRun?.generatedAt).toBe(NOW);
    expect(finalRun?.generatingLeaseExpiresAt).toBeUndefined();
  });

  it("returns RUN_NOT_FOUND when the run doesn't exist, never throws", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT)]);
    const deps = makeDeps(store, makeExportStore());
    const result = await processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: "nope" });
    expect(result).toEqual({ kind: "RUN_NOT_FOUND" });
  });

  it("is idempotent: a run already READY/FAILED/TOO_LARGE is a no-op (ALREADY_RESOLVED), never regenerates", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT)]);
    await store.transactWrite([{ Put: { TableName: "test-table", Item: makeRun({ status: "READY", generatedAt: NOW }) as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore = makeExportStore();
    const deps = makeDeps(store, exportStore);

    const result = await processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: RUN_ID });
    expect(result).toEqual({ kind: "ALREADY_RESOLVED", status: "READY" });
    expect(exportStore.pdfCalls).toHaveLength(0);
  });

  it("skips a redelivered message while generation is genuinely in flight (unexpired lease)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT)]);
    const futureLease = "2026-09-06T10:10:00.000Z"; // after NOW
    await store.transactWrite([{ Put: { TableName: "test-table", Item: makeRun({ status: "GENERATING", generatingLeaseExpiresAt: futureLease }) as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore = makeExportStore();
    const deps = makeDeps(store, exportStore);

    const result = await processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: RUN_ID });
    expect(result).toEqual({ kind: "SKIPPED_IN_PROGRESS" });
    expect(exportStore.pdfCalls).toHaveLength(0);
  });

  it("reclaims a run stuck in GENERATING once its lease has expired (a previous invocation crashed)", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), makeRequirement("req-1"), makeRequirement("req-2")]);
    const pastLease = "2026-09-06T09:00:00.000Z"; // before NOW
    await store.transactWrite([{ Put: { TableName: "test-table", Item: makeRun({ status: "GENERATING", generatingLeaseExpiresAt: pastLease }) as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore = makeExportStore();
    const deps = makeDeps(store, exportStore);

    const result = await processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: RUN_ID });
    expect(result).toEqual({ kind: "READY", requirementCount: 2 });
  });

  it("declares TOO_LARGE (never a silently-truncated artifact) when the frozen scope exceeds MAX_DOSSIER_REQUIREMENTS", async () => {
    const requirementIds = Array.from({ length: MAX_DOSSIER_REQUIREMENTS + 1 }, (_, i) => `req-${i}`);
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), ...requirementIds.map((id) => makeRequirement(id))]);
    await store.transactWrite([{ Put: { TableName: "test-table", Item: makeRun({ requirementIds }) as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore = makeExportStore();
    const deps = makeDeps(store, exportStore);

    const result = await processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: RUN_ID });
    expect(result).toEqual({ kind: "TOO_LARGE", requirementCount: MAX_DOSSIER_REQUIREMENTS + 1 });
    expect(exportStore.pdfCalls).toHaveLength(0);
    const finalRun = await store.get<DossierExportRun>(dossierExportRunKey(TENANT, SUBJECT, RUN_ID));
    expect(finalRun?.status).toBe("TOO_LARGE");
    expect(finalRun?.failureReason).toBeTruthy();
  });

  it("silently omits (never fabricates) a Requirement deleted since confirm, still generates successfully for what remains", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), makeRequirement("req-1")]); // req-2 was in scope but deleted
    await store.transactWrite([{ Put: { TableName: "test-table", Item: makeRun({ requirementIds: ["req-1", "req-2"] }) as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore = makeExportStore();
    const deps = makeDeps(store, exportStore);

    const result = await processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: RUN_ID });
    expect(result).toEqual({ kind: "READY", requirementCount: 1 });
  });

  it("marks the run FAILED (and rethrows) when document generation/upload throws", async () => {
    const store = new InMemoryDocumentArchiveStore([seedActiveTenantLifecycle(TENANT), seedActiveTrackedSubject(TENANT, SUBJECT), makeRequirement("req-1"), makeRequirement("req-2")]);
    await store.transactWrite([{ Put: { TableName: "test-table", Item: makeRun() as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore: DossierExportStore = {
      async putPdf() {
        throw new Error("S3 is down");
      },
      async putXlsx() {},
      async presignDownload() {
        return "unused";
      },
    };
    const deps = makeDeps(store, exportStore);

    await expect(processDossierExportGeneration(deps, { tenantId: TENANT, subjectId: SUBJECT, runId: RUN_ID })).rejects.toThrow("S3 is down");
    const finalRun = await store.get<DossierExportRun>(dossierExportRunKey(TENANT, SUBJECT, RUN_ID));
    expect(finalRun?.status).toBe("FAILED");
    expect(finalRun?.failureReason).toBe("S3 is down");
  });
});
