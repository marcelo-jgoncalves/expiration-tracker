import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore, FakeImportObjectStore } from "./in-memory-store.js";
import { InMemorySubjectStore } from "../subject/in-memory-store.js";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { parseImportJob, type ImportParseDeps } from "../../../src/modules/import/application/import-parse-service.js";
import { importJobKey, type ImportJob, type ColumnMapping } from "../../../src/modules/import/domain/import-job.js";
import { subjectKey, subjectExternalIdPointerKey, type TrackedSubject, type SubjectExternalIdPointer } from "../../../src/modules/subject/domain/tracked-subject.js";
import { documentTypeKey, type DocumentType } from "../../../src/modules/document-archive/domain/document-type.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

type SeedItem = Record<string, unknown> & EntityKey;

const TENANT = "tenant-1";
const RAW_BUCKET = "raw-bucket";
const PLAN_BUCKET = "plan-bucket";
const NOW = "2026-09-03T12:00:00.000Z";

function seedSubject(id: string): SeedItem {
  const subject: TrackedSubject = {
    ...subjectKey(TENANT, id),
    entityType: "TrackedSubject",
    subjectId: id,
    tenantId: TENANT,
    type: "VENDOR",
    displayName: `Subject ${id}`,
    displayNameNormalized: `subject ${id}`,
    tags: [],
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI7PK: `TENANT#${TENANT}#SUBJECTSTATUS#ACTIVE`,
    GSI7SK: `VENDOR#subject ${id}#${id}`,
  };
  return subject as unknown as SeedItem;
}

function seedDocumentType(id: string): SeedItem {
  const documentType: DocumentType = {
    ...documentTypeKey(TENANT, id),
    entityType: "DocumentType",
    documentTypeId: id,
    tenantId: TENANT,
    displayName: id,
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI1PK: `TENANT#${TENANT}#DOCTYPESTATUS#ACTIVE`,
    GSI1SK: `NAME#${id.toLowerCase()}#DOCTYPE#${id}`,
  };
  return documentType as unknown as SeedItem;
}

const DOCUMENT_MAPPING: ColumnMapping = {
  schemaVersion: 1,
  targetKind: "Document",
  columns: {
    subjectRef: "subjectId",
    subjectRefKind: "SUBJECT_ID",
    documentTypeRef: "documentTypeId",
    documentTypeRefKind: "DOCUMENT_TYPE_ID",
    hasValidity: "hasValidity",
  },
};

const REQUIREMENT_MAPPING: ColumnMapping = {
  schemaVersion: 1,
  targetKind: "Requirement",
  columns: {
    subjectRef: "subjectId",
    subjectRefKind: "SUBJECT_ID",
    name: "name",
  },
};

describe("parseImportJob — Document/Requirement branch (D-192 §4/§7, fatia 7)", () => {
  let store: InMemoryImportStore;
  let subjectStore: InMemorySubjectStore;
  let documentArchiveStore: InMemoryDocumentArchiveStore;
  let objectStore: FakeImportObjectStore;
  let quota: TenantQuotaService;

  beforeEach(async () => {
    store = new InMemoryImportStore();
    objectStore = new FakeImportObjectStore();
    const identityStore = new InMemoryIdentityStore();
    await identityStore.putIfAbsent({
      ...tenantLifecycleKey(TENANT),
      entityType: "TenantLifecycleRecord",
      tenantId: TENANT,
      status: "ACTIVE",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });
    quota = new TenantQuotaService(identityStore, "MainTable", () => NOW);
    subjectStore = new InMemorySubjectStore([seedSubject("s1"), seedSubject("s2")]);
    documentArchiveStore = new InMemoryDocumentArchiveStore([seedDocumentType("dt1")]);
  });

  function deps(): ImportParseDeps {
    return { store, subjectStore, objectStore, documentArchiveStore, rawBucket: RAW_BUCKET, planBucket: PLAN_BUCKET, quota, tableName: "MainTable", now: () => NOW };
  }

  async function seedJob(jobId: string, targetEntityType: "Document" | "Requirement", columnMapping: ColumnMapping) {
    const job: ImportJob = {
      ...importJobKey(TENANT, jobId),
      entityType: "ImportJob",
      jobId,
      tenantId: TENANT,
      targetEntityType,
      status: "UPLOADED",
      createdByUserId: "user-1",
      columnMapping,
      expiresAt: "2026-09-10T12:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    await store.putIfAbsent(job);
  }

  it("resolves a valid Document row and rejects a row with a bad subjectRef and a row with a bad documentTypeRef (distinguishable reasons)", async () => {
    await seedJob("job-doc", "Document", DOCUMENT_MAPPING);
    objectStore.seed(
      RAW_BUCKET,
      `tenant/${TENANT}/imports/job-doc/raw.csv`,
      "subjectId,documentTypeId,hasValidity\n" + "s1,dt1,true\n" + "ghost-subject,dt1,true\n" + "s2,ghost-doctype,false\n",
    );

    const outcome = await parseImportJob(deps(), TENANT, "job-doc");
    expect(outcome).toEqual({ kind: "PARSED", totalRows: 3, acceptedRows: 1, rejectedRows: 2, duplicateRows: 0 });

    const job = await store.get<ImportJob>(importJobKey(TENANT, "job-doc"));
    const plan = (await objectStore.getObject(PLAN_BUCKET, job!.planObjectKey!))
      .toString("utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ rowNumber: 1, action: "CREATE_DOCUMENT", subjectId: "s1", documentTypeId: "dt1" });
    expect(plan[1]).toMatchObject({ rowNumber: 2, action: "REJECT", reason: "SUBJECT_REFERENCE_NOT_FOUND" });
    expect(plan[2]).toMatchObject({ rowNumber: 3, action: "REJECT", reason: "DOCUMENT_TYPE_NOT_FOUND" });
  });

  it("resolves a valid Requirement row and rejects a row with a bad subjectRef", async () => {
    await seedJob("job-req", "Requirement", REQUIREMENT_MAPPING);
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/job-req/raw.csv`, "subjectId,name\n" + "s1,Fire Safety Certificate\n" + "ghost-subject,Some Requirement\n");

    const outcome = await parseImportJob(deps(), TENANT, "job-req");
    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 1, rejectedRows: 1, duplicateRows: 0 });

    const job = await store.get<ImportJob>(importJobKey(TENANT, "job-req"));
    const plan = (await objectStore.getObject(PLAN_BUCKET, job!.planObjectKey!))
      .toString("utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ rowNumber: 1, action: "CREATE_REQUIREMENT", subjectId: "s1" });
    expect(plan[1]).toMatchObject({ rowNumber: 2, action: "REJECT", reason: "SUBJECT_REFERENCE_NOT_FOUND" });
  });

  it("dedupes references within the batch - two Document rows sharing a subjectRef only trigger one subject batchGet call", async () => {
    await seedJob("job-doc-dedupe", "Document", DOCUMENT_MAPPING);
    objectStore.seed(
      RAW_BUCKET,
      `tenant/${TENANT}/imports/job-doc-dedupe/raw.csv`,
      "subjectId,documentTypeId,hasValidity\n" + "s1,dt1,true\n" + "s1,dt1,false\n",
    );

    const outcome = await parseImportJob(deps(), TENANT, "job-doc-dedupe");
    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 2, rejectedRows: 0, duplicateRows: 0 });
    // SUBJECT_ID-kind skips phase 1 entirely - a single phase-2 batchGet call resolves the one
    // distinct subjectId shared by both rows, never two separate lookups.
    expect(subjectStore.batchGetCallCount).toBe(1);
    expect(subjectStore.batchGetKeyCount).toBe(1);
    expect(documentArchiveStore.batchGetCallCount).toBe(1);
    expect(documentArchiveStore.batchGetKeyCount).toBe(1);
  });

  it("rejects a second row sharing the same externalId within the file as DUPLICATE_IN_FILE, first row still creates", async () => {
    const mappingWithExternalId: ColumnMapping = {
      ...DOCUMENT_MAPPING,
      columns: { ...DOCUMENT_MAPPING.columns, externalId: "externalId" },
    };
    await seedJob("job-doc-dup-ext", "Document", mappingWithExternalId);
    objectStore.seed(
      RAW_BUCKET,
      `tenant/${TENANT}/imports/job-doc-dup-ext/raw.csv`,
      "subjectId,documentTypeId,hasValidity,externalId\n" + "s1,dt1,true,ext-x\n" + "s2,dt1,true,ext-x\n",
    );

    const outcome = await parseImportJob(deps(), TENANT, "job-doc-dup-ext");
    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 1, rejectedRows: 1, duplicateRows: 0 });

    const job = await store.get<ImportJob>(importJobKey(TENANT, "job-doc-dup-ext"));
    const plan = (await objectStore.getObject(PLAN_BUCKET, job!.planObjectKey!))
      .toString("utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(plan[0]).toMatchObject({ rowNumber: 1, action: "CREATE_DOCUMENT" });
    expect(plan[1]).toMatchObject({ rowNumber: 2, action: "REJECT", reason: "DUPLICATE_IN_FILE" });
  });

  it("resolves EXTERNAL_ID-kind Subject references for a Requirement job, deduping the pointer lookup across the batch", async () => {
    const pointerId = "ext-1";
    const pointer: SubjectExternalIdPointer = {
      ...subjectExternalIdPointerKey(TENANT, pointerId),
      entityType: "SubjectExternalIdPointer",
      tenantId: TENANT,
      externalId: pointerId,
      subjectId: "s1",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    subjectStore = new InMemorySubjectStore([seedSubject("s1"), pointer as unknown as SeedItem]);
    const mapping: ColumnMapping = { ...REQUIREMENT_MAPPING, columns: { ...REQUIREMENT_MAPPING.columns, subjectRefKind: "EXTERNAL_ID" } };
    await seedJob("job-req-ext", "Requirement", mapping);
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/job-req-ext/raw.csv`, "subjectId,name\n" + "ext-1,Req A\n" + "ext-1,Req B\n");

    const outcome = await parseImportJob(deps(), TENANT, "job-req-ext");
    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 2, rejectedRows: 0, duplicateRows: 0 });
    // Phase 1 (pointer lookup, 1 distinct externalId) + phase 2 (real Subject, 1 distinct id).
    expect(subjectStore.batchGetCallCount).toBe(2);
    expect(subjectStore.batchGetKeyCount).toBe(2);
  });
});
