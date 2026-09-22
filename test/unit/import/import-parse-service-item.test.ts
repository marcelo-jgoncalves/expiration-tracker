import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore, FakeImportObjectStore } from "./in-memory-store.js";
import { InMemorySubjectStore } from "../subject/in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { parseImportJob, type ImportParseDeps } from "../../../src/modules/import/application/import-parse-service.js";
import { importJobKey, DEFAULT_ITEM_COLUMN_MAPPING, type ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { importDedupKey, type ImportDedupRecord } from "../../../src/modules/import/domain/import-dedup.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/**
 * D-3xx (2026-09-21, PENDING_PROTOCOL_REVIEW) — Item branch of parseImportJob. Mirrors
 * import-parse-service.test.ts's TrackedSubject coverage shape (same dedup vocabulary: in-file
 * collision REJECT, cross-job SKIP_DUPLICATE via ImportDedupRecord) minus the weak-fallback
 * preload TrackedSubject has (Item has none - import-dedup.ts's "ITEM" kind comment explains
 * why), and never exercises resolve-subject-references.ts (Item has no subjectRef at all).
 */
const TENANT = "tenant-1";
const JOB_ID = "job-item-1";
const RAW_BUCKET = "raw-bucket";
const PLAN_BUCKET = "plan-bucket";
const NOW = "2026-09-21T12:00:00.000Z";

describe("parseImportJob — Item branch (D-3xx, PENDING_PROTOCOL_REVIEW)", () => {
  let store: InMemoryImportStore;
  let subjectStore: InMemorySubjectStore;
  let objectStore: FakeImportObjectStore;
  let quota: TenantQuotaService;

  beforeEach(async () => {
    store = new InMemoryImportStore();
    subjectStore = new InMemorySubjectStore();
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

    const job: ImportJob = {
      ...importJobKey(TENANT, JOB_ID),
      entityType: "ImportJob",
      jobId: JOB_ID,
      tenantId: TENANT,
      targetEntityType: "Item",
      status: "UPLOADED",
      createdByUserId: "user-1",
      columnMapping: DEFAULT_ITEM_COLUMN_MAPPING,
      expiresAt: "2026-09-28T12:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    await store.putIfAbsent(job);
  });

  function deps(): ImportParseDeps {
    return { store, subjectStore, objectStore, rawBucket: RAW_BUCKET, planBucket: PLAN_BUCKET, quota, tableName: "MainTable", now: () => NOW };
  }

  // Would fail if the Item branch stopped writing a CREATE_ITEM plan entry, or dropped
  // normalization of dueDate to a full ISO date-time.
  it("parses a valid Item CSV, writes the plan to S3, and marks the job PREVIEW_READY", async () => {
    objectStore.seed(
      RAW_BUCKET,
      `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`,
      "name,category,dueDate\n" + "Alvara de Funcionamento,Licenca,2026-12-31\n" + "Seguro de Frota,Seguro,2027-03-15\n",
    );

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 2, rejectedRows: 0, duplicateRows: 0 });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(job?.status).toBe("PREVIEW_READY");

    const plan = (await objectStore.getObject(PLAN_BUCKET, job!.planObjectKey!))
      .toString("utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ rowNumber: 1, action: "CREATE_ITEM" });
    expect(plan[0].row.dueDate).toBe("2026-12-31T00:00:00.000Z");
  });

  // Would fail if structural validation (MISSING_DUE_DATE) stopped short-circuiting the whole job.
  it("rejects structurally invalid rows without failing the whole job", async () => {
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, "name,category,dueDate\n" + "Alvara,Licenca,2026-12-31\n" + "Sem Data,Licenca,\n");

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 1, rejectedRows: 1, duplicateRows: 0 });
  });

  // Would fail if the in-file dedup-key collision check (seenDedupKeysInFile) were removed,
  // letting both rows through as CREATE_ITEM.
  it("rejects an in-file collision on the same synthetic dedup key (same name+category+dueDate twice)", async () => {
    objectStore.seed(
      RAW_BUCKET,
      `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`,
      "name,category,dueDate\n" + "Alvara,Licenca,2026-12-31\n" + "Alvara,Licenca,2026-12-31\n",
    );

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 1, rejectedRows: 1, duplicateRows: 0 });
  });

  // Would fail if a legitimately recurring item (same name/category, different dueDate) were
  // wrongly rejected as an in-file collision - dueDate must be part of the dedup key.
  it("accepts the SAME name+category with a DIFFERENT dueDate as two distinct rows (recurring item, not a duplicate)", async () => {
    objectStore.seed(
      RAW_BUCKET,
      `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`,
      "name,category,dueDate\n" + "Alvara,Licenca,2026-12-31\n" + "Alvara,Licenca,2027-12-31\n",
    );

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 2, rejectedRows: 0, duplicateRows: 0 });
  });

  // Would fail if the cross-job ImportDedupRecord point-lookup were skipped, re-accepting a row
  // already imported by a prior job.
  it("skips a row whose synthetic dedup key already exists from a PRIOR import", async () => {
    await store.putIfAbsent<ImportDedupRecord>({
      ...importDedupKey(TENANT, "ITEM", "licenca|alvara|2026-12-31T00:00:00.000Z"),
      entityType: "ImportDedupRecord",
      tenantId: TENANT,
      kind: "ITEM",
      externalId: "licenca|alvara|2026-12-31T00:00:00.000Z",
      subjectId: "item-existing",
      createdAt: NOW,
    });
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, "name,category,dueDate\n" + "Alvara,Licenca,2026-12-31\n");

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 1, acceptedRows: 0, rejectedRows: 0, duplicateRows: 1 });
  });
});
