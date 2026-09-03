import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore, FakeImportObjectStore, activeLifecycleRecord } from "./in-memory-store.js";
import { InMemorySubjectStore, makeSubjectIdGenerator } from "../subject/in-memory-store.js";
import { SubjectService } from "../../../src/modules/subject/application/subject-service.js";
import { commitImportJob } from "../../../src/modules/import/application/import-commit-service.js";
import { importJobKey, type ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { importDedupKey, type ImportDedupRecord } from "../../../src/modules/import/domain/import-dedup.js";
import { importRowOutcomeKey, type ImportRowOutcome } from "../../../src/modules/import/domain/import-row-outcome.js";
import type { ImportRowPlanEntry, DocumentImportRowPlanEntry, RequirementImportRowPlanEntry } from "../../../src/modules/import/domain/import-row.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { defaultEntitlement, type TenantEntitlement } from "../../../src/modules/subject/domain/entitlement.js";
import type { DocumentArchiveIdGenerator } from "../../../src/modules/document-archive/application/id-generator.js";

function makeDocumentArchiveIds(): DocumentArchiveIdGenerator {
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
    newRequirementTemplateId: () => `reqtpl-${++n}`,
    newRequirementTemplateItemId: () => `reqtplitem-${++n}`,
  };
}

const TENANT = "tenant-1";
const JOB_ID = "job-1";
const PLAN_BUCKET = "plan-bucket";
const NOW = "2026-08-23T12:00:00.000Z";

function ctx(): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
  };
}

function planEntry(rowNumber: number, overrides: Partial<Extract<ImportRowPlanEntry, { action: "CREATE_SUBJECT" }>["row"]> = {}): ImportRowPlanEntry {
  return {
    rowNumber,
    action: "CREATE_SUBJECT",
    row: { rowNumber, displayName: `Subject ${rowNumber}`, type: "VENDOR", tags: [], warnings: [], ...overrides },
  };
}

describe("commitImportJob (M11, D-042)", () => {
  let store: InMemoryImportStore;
  let subjectStore: InMemorySubjectStore;
  let objectStore: FakeImportObjectStore;
  let subjects: SubjectService;

  beforeEach(async () => {
    store = new InMemoryImportStore();
    subjectStore = new InMemorySubjectStore();
    objectStore = new FakeImportObjectStore();
    subjects = new SubjectService({ store: subjectStore, tableName: "MainTable", ids: makeSubjectIdGenerator(), now: () => NOW });

    const job: ImportJob = {
      ...importJobKey(TENANT, JOB_ID),
      entityType: "ImportJob",
      jobId: JOB_ID,
      tenantId: TENANT,
      targetEntityType: "TrackedSubject",
      status: "COMMITTING",
      createdByUserId: "user-1",
      expiresAt: "2026-08-30T12:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    await store.putIfAbsent(job);
  });

  function deps() {
    return { store, objectStore, planBucket: PLAN_BUCKET, tableName: "MainTable", subjects, documentArchiveIds: makeDocumentArchiveIds(), now: () => NOW };
  }

  async function seedPlan(entries: ImportRowPlanEntry[]): Promise<string> {
    const content = entries.map((e) => JSON.stringify(e)).join("\n");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(content, "utf-8").digest("hex");
    const key = `tenant/${TENANT}/imports/${JOB_ID}/plan/page-0.jsonl`;
    objectStore.seed(PLAN_BUCKET, key, content);
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, planObjectKey: key, planSha256: sha256 });
    return sha256;
  }

  it("creates a TrackedSubject per CREATE_SUBJECT entry and marks the job COMMITTED", async () => {
    await seedPlan([planEntry(1), planEntry(2)]);

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    expect(outcome).toEqual({ kind: "COMMITTED", createdCount: 2 });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(job?.status).toBe("COMMITTED");
    expect(job?.lastCommittedRowNumber).toBe(2);

    const created = subjectStore.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    expect(created).toHaveLength(2);
  });

  it("fails the job with FAILED_INTEGRITY_MISMATCH when the plan content no longer matches planSha256", async () => {
    await seedPlan([planEntry(1)]);
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    // Plan mutated after preview - the exact scenario planSha256 exists to catch.
    objectStore.seed(PLAN_BUCKET, job!.planObjectKey!, JSON.stringify(planEntry(1, { displayName: "TAMPERED" })));

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    expect(outcome).toEqual({ kind: "FAILED_INTEGRITY_MISMATCH" });
    const failedJob = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(failedJob?.status).toBe("FAILED");
  });

  it("is a no-op when the job is not COMMITTING", async () => {
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, status: "PREVIEW_READY" });

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);
    expect(outcome).toEqual({ kind: "SKIPPED_NOT_COMMITTING" });
  });

  it("retry safety: re-running commit for an already-committed job never creates duplicate subjects (idempotent restart, SQS at-least-once)", async () => {
    await seedPlan([planEntry(1), planEntry(2), planEntry(3)]);

    const first = await commitImportJob(deps(), ctx(), JOB_ID);
    expect(first).toEqual({ kind: "COMMITTED", createdCount: 3 });

    // Simulate a retry of the SAME SQS message after the job already reached COMMITTED -
    // re-run against a job manually reset to COMMITTING (mirrors a worker crash right before
    // marking it COMMITTED, then a retry) to prove no row is re-created.
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, status: "COMMITTING" });

    const second = await commitImportJob(deps(), ctx(), JOB_ID);
    expect(second).toEqual({ kind: "COMMITTED", createdCount: 0 }); // nothing NEW created

    const created = subjectStore.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    expect(created).toHaveLength(3); // still exactly 3, never duplicated
  });

  it("retry safety: a row without externalId is never duplicated on retry either (synthetic per-row dedup key)", async () => {
    await seedPlan([planEntry(1)]); // no externalId on this row

    await commitImportJob(deps(), ctx(), JOB_ID);
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, status: "COMMITTING", lastCommittedRowNumber: 0 }); // simulate a retry that lost its cursor progress

    await commitImportJob(deps(), ctx(), JOB_ID);

    const created = subjectStore.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    expect(created).toHaveLength(1); // the dedup claim (not the cursor) is what actually prevented the duplicate
  });

  it("stops fail-fast on entitlement exceeded, without processing the remaining rows", async () => {
    await subjectStore.putIfAbsent<TenantEntitlement>({ ...defaultEntitlement(TENANT, NOW), activeTrackedSubjectsLimit: 1 });
    await seedPlan([planEntry(1), planEntry(2), planEntry(3)]);

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    expect(outcome).toEqual({ kind: "FAILED_ENTITLEMENT_EXCEEDED", createdCount: 1 });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(job?.status).toBe("FAILED");
    expect(job?.failureReason).toBe("ENTITLEMENT_EXCEEDED");
    const created = subjectStore.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    expect(created).toHaveLength(1); // only the first row committed before the limit hit
  });

  it("resumes from lastCommittedRowNumber on a real restart, never reprocessing rows already past the cursor", async () => {
    await seedPlan([planEntry(1), planEntry(2), planEntry(3)]);
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, lastCommittedRowNumber: 1 }); // pretend row 1 already committed by a prior attempt

    await commitImportJob(deps(), ctx(), JOB_ID);

    // Row 1 was never (re)created here - only rows 2 and 3 should exist.
    const created = subjectStore.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    expect(created).toHaveLength(2);
    expect(created.map((c) => (c as unknown as { displayName: string }).displayName).sort()).toEqual(["Subject 2", "Subject 3"]);
  });

  it("SKIP_DUPLICATE and REJECT plan entries are never committed", async () => {
    await seedPlan([
      planEntry(1),
      { rowNumber: 2, action: "SKIP_DUPLICATE", reason: "EXTERNAL_ID_ALREADY_EXISTS", externalId: "ext-2", displayName: "Skip me" },
      { rowNumber: 3, action: "REJECT", reason: "MISSING_DISPLAY_NAME" },
    ]);

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    expect(outcome).toEqual({ kind: "COMMITTED", createdCount: 1 });
    const created = subjectStore.allItems().filter((i) => i["entityType"] === "TrackedSubject");
    expect(created).toHaveLength(1);
  });

  it("writes an ImportDedupRecord for every committed row, including synthetic keys for rows without externalId", async () => {
    await seedPlan([planEntry(1, { externalId: "ext-1" }), planEntry(2)]);

    await commitImportJob(deps(), ctx(), JOB_ID);

    const strongDedup = await store.get<ImportDedupRecord>(importDedupKey(TENANT, "SUBJECT", "ext-1"));
    expect(strongDedup?.subjectId).toBeTruthy();
    const syntheticDedup = await store.get<ImportDedupRecord>(importDedupKey(TENANT, "SUBJECT", `job:${JOB_ID}:row:2`));
    expect(syntheticDedup?.subjectId).toBeTruthy();
  });
});

/** D-192 §6 (fatia 8) - Document/Requirement commit path: TENTATIVA/FALLBACK two-transaction
 * protocol, `ImportRowOutcome` ledger, cursor-based resume. Highest-stakes suite of this
 * slice - failure paths (domain-fence TOCTOU, resumed run) matter more than the happy path. */
describe("commitImportJob - Document/Requirement (D-192 §6, fatia 8)", () => {
  const SUBJECT_ID = "subject-1";
  const DOCTYPE_ID = "doctype-1";

  let store: InMemoryImportStore;
  let objectStore: FakeImportObjectStore;
  let subjects: SubjectService;

  function seedActiveTrackedSubject(subjectId: string): Record<string, unknown> & { PK: string; SK: string } {
    return {
      PK: `TENANT#${TENANT}#SUBJECT#${subjectId}`,
      SK: "META",
      entityType: "TrackedSubject",
      tenantId: TENANT,
      subjectId,
      status: "ACTIVE",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
  }

  function seedActiveDocumentType(documentTypeId: string): Record<string, unknown> & { PK: string; SK: string } {
    return {
      PK: `TENANT#${TENANT}#DOCTYPE#${documentTypeId}`,
      SK: "METADATA",
      entityType: "DocumentType",
      tenantId: TENANT,
      documentTypeId,
      status: "ACTIVE",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
  }

  async function makeJob(targetEntityType: "Document" | "Requirement"): Promise<void> {
    const job: ImportJob = {
      ...importJobKey(TENANT, JOB_ID),
      entityType: "ImportJob",
      jobId: JOB_ID,
      tenantId: TENANT,
      targetEntityType,
      status: "COMMITTING",
      createdByUserId: "user-1",
      expiresAt: "2026-08-30T12:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    await store.putIfAbsent(job);
  }

  beforeEach(async () => {
    store = new InMemoryImportStore();
    objectStore = new FakeImportObjectStore();
    subjects = new SubjectService({ store: new InMemorySubjectStore(), tableName: "MainTable", ids: makeSubjectIdGenerator(), now: () => NOW });
    await store.putIfAbsent(activeLifecycleRecord(TENANT, NOW));
    await store.putIfAbsent(seedActiveTrackedSubject(SUBJECT_ID));
    await store.putIfAbsent(seedActiveDocumentType(DOCTYPE_ID));
  });

  function deps() {
    return { store, objectStore, planBucket: PLAN_BUCKET, tableName: "MainTable", subjects, documentArchiveIds: makeDocumentArchiveIds(), now: () => NOW };
  }

  async function seedPlan(entries: Array<DocumentImportRowPlanEntry | RequirementImportRowPlanEntry>): Promise<void> {
    const content = entries.map((e) => JSON.stringify(e)).join("\n");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(content, "utf-8").digest("hex");
    const key = `tenant/${TENANT}/imports/${JOB_ID}/plan/page-0.jsonl`;
    objectStore.seed(PLAN_BUCKET, key, content);
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, planObjectKey: key, planSha256: sha256 });
  }

  function documentEntry(rowNumber: number, overrides: Partial<{ subjectId: string; documentTypeId: string; externalId?: string }> = {}): DocumentImportRowPlanEntry {
    return {
      rowNumber,
      action: "CREATE_DOCUMENT",
      row: { rowNumber, subjectRef: SUBJECT_ID, documentTypeRef: DOCTYPE_ID, hasValidity: true, externalId: overrides.externalId, warnings: [] },
      subjectId: overrides.subjectId ?? SUBJECT_ID,
      documentTypeId: overrides.documentTypeId ?? DOCTYPE_ID,
    };
  }

  function requirementEntry(rowNumber: number, overrides: Partial<{ subjectId: string; externalId?: string }> = {}): RequirementImportRowPlanEntry {
    return {
      rowNumber,
      action: "CREATE_REQUIREMENT",
      row: { rowNumber, subjectRef: SUBJECT_ID, name: `Requirement ${rowNumber}`, applicability: "APPLICABLE", externalId: overrides.externalId, warnings: [] },
      subjectId: overrides.subjectId ?? SUBJECT_ID,
    };
  }

  it("creates a Document per CREATE_DOCUMENT entry, records a COMMITTED ImportRowOutcome, and marks the job COMMITTED", async () => {
    await makeJob("Document");
    await seedPlan([documentEntry(1), documentEntry(2)]);

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    expect(outcome).toEqual({ kind: "COMMITTED", createdCount: 2 });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(job?.status).toBe("COMMITTED");
    expect(job?.lastCommittedRowNumber).toBe(2);

    const created = store.allItems().filter((i) => i["entityType"] === "Document");
    expect(created).toHaveLength(2);

    const outcome1 = await store.get<ImportRowOutcome>(importRowOutcomeKey(TENANT, JOB_ID, 1));
    expect(outcome1?.outcome).toBe("COMMITTED");
    expect(outcome1?.entityId).toBeTruthy();
  });

  it("creates a Requirement per CREATE_REQUIREMENT entry (planner wiring proven end to end, not just Document)", async () => {
    await makeJob("Requirement");
    await seedPlan([requirementEntry(1)]);

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    expect(outcome).toEqual({ kind: "COMMITTED", createdCount: 1 });
    const created = store.allItems().filter((i) => i["entityType"] === "Requirement");
    expect(created).toHaveLength(1);
    const rowOutcome = await store.get<ImportRowOutcome>(importRowOutcomeKey(TENANT, JOB_ID, 1));
    expect(rowOutcome?.outcome).toBe("COMMITTED");
  });

  it("a Subject archived between preview and commit (real TOCTOU) marks the row FAILED with the right reason and the job continues to the next row instead of aborting", async () => {
    await makeJob("Document");
    await seedPlan([documentEntry(1), documentEntry(2)]);

    // Simulate the TOCTOU: the Subject the plan already froze subjectId for gets archived
    // AFTER preview but BEFORE this commit runs.
    await store.update({ ...seedActiveTrackedSubject(SUBJECT_ID), status: "ARCHIVED", version: 2 });

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    // Job still reaches COMMITTED overall - a row-level failure is not a job-level abort.
    expect(outcome).toEqual({ kind: "COMMITTED", createdCount: 0 });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(job?.status).toBe("COMMITTED");
    expect(job?.lastCommittedRowNumber).toBe(2); // both rows processed (both failed, cursor still advances past each)

    const created = store.allItems().filter((i) => i["entityType"] === "Document");
    expect(created).toHaveLength(0); // never double-committed / never silently created despite the fence

    const outcome1 = await store.get<ImportRowOutcome>(importRowOutcomeKey(TENANT, JOB_ID, 1));
    expect(outcome1?.outcome).toBe("FAILED");
    expect(outcome1?.failureReason).toBe("SUBJECT_REFERENCE_NOT_FOUND");
    const outcome2 = await store.get<ImportRowOutcome>(importRowOutcomeKey(TENANT, JOB_ID, 2));
    expect(outcome2?.outcome).toBe("FAILED");
    expect(outcome2?.failureReason).toBe("SUBJECT_REFERENCE_NOT_FOUND");
  });

  it("retry safety: a resumed commit run skips an already-succeeded row (never double-creates) via the cursor+ledger", async () => {
    await makeJob("Document");
    await seedPlan([documentEntry(1), documentEntry(2)]);

    const first = await commitImportJob(deps(), ctx(), JOB_ID);
    expect(first).toEqual({ kind: "COMMITTED", createdCount: 2 });

    // Simulate a retry of the same SQS message after the job already reached COMMITTED (worker
    // crash right before marking it COMMITTED, then a retry) - reset status only, cursor/ledger
    // rows are left exactly as the first run wrote them.
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, status: "COMMITTING" });

    const second = await commitImportJob(deps(), ctx(), JOB_ID);
    expect(second).toEqual({ kind: "COMMITTED", createdCount: 0 }); // nothing NEW created

    const created = store.allItems().filter((i) => i["entityType"] === "Document");
    expect(created).toHaveLength(2); // still exactly 2, never duplicated
  });

  it("retry safety: a resumed commit run also skips an already-FAILED row (never retries it) via the ledger", async () => {
    await makeJob("Document");
    await seedPlan([documentEntry(1)]);
    await store.update({ ...seedActiveTrackedSubject(SUBJECT_ID), status: "ARCHIVED", version: 2 });

    const first = await commitImportJob(deps(), ctx(), JOB_ID);
    expect(first).toEqual({ kind: "COMMITTED", createdCount: 0 });
    const firstOutcome = await store.get<ImportRowOutcome>(importRowOutcomeKey(TENANT, JOB_ID, 1));
    expect(firstOutcome?.outcome).toBe("FAILED");

    // Re-activate the Subject (so if the row WERE wrongly retried, it would now succeed) and
    // simulate a retry - the row must stay skipped/FAILED, never silently retried into success.
    await store.update({ ...seedActiveTrackedSubject(SUBJECT_ID), version: 3 });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, status: "COMMITTING" });

    const second = await commitImportJob(deps(), ctx(), JOB_ID);
    expect(second).toEqual({ kind: "COMMITTED", createdCount: 0 });

    const created = store.allItems().filter((i) => i["entityType"] === "Document");
    expect(created).toHaveLength(0); // never retried into existence
    const secondOutcome = await store.get<ImportRowOutcome>(importRowOutcomeKey(TENANT, JOB_ID, 1));
    expect(secondOutcome?.outcome).toBe("FAILED"); // ledger entry unchanged, not overwritten
  });

  it("writes an ImportDedupRecord scoped to the frozen subjectId when the row has an externalId", async () => {
    await makeJob("Document");
    await seedPlan([documentEntry(1, { externalId: "doc-ext-1" })]);

    await commitImportJob(deps(), ctx(), JOB_ID);

    const dedup = await store.get<ImportDedupRecord>(importDedupKey(TENANT, "DOCUMENT", "doc-ext-1", SUBJECT_ID));
    expect(dedup?.kind).toBe("DOCUMENT");
    expect(dedup?.entityId).toBeTruthy();
  });

  it("a duplicate externalId against an already-committed Document (business dedup, §7) fails the row instead of creating a duplicate", async () => {
    await makeJob("Document");
    await seedPlan([documentEntry(1, { externalId: "dup-ext" }), documentEntry(2, { externalId: "dup-ext" })]);

    const outcome = await commitImportJob(deps(), ctx(), JOB_ID);

    // Row 1 succeeds, row 2 collides on the SAME subjectId+externalId dedup key.
    expect(outcome).toEqual({ kind: "COMMITTED", createdCount: 1 });
    const created = store.allItems().filter((i) => i["entityType"] === "Document");
    expect(created).toHaveLength(1);
    const outcome2 = await store.get<ImportRowOutcome>(importRowOutcomeKey(TENANT, JOB_ID, 2));
    expect(outcome2?.outcome).toBe("FAILED");
    expect(outcome2?.failureReason).toBe("EXTERNAL_ID_ALREADY_EXISTS");
  });
});
