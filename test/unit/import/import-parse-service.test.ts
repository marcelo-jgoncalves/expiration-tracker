import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore, FakeImportObjectStore } from "./in-memory-store.js";
import { InMemorySubjectStore } from "../subject/in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { parseImportJob } from "../../../src/modules/import/application/import-parse-service.js";
import { importJobKey, type ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { importDedupKey, type ImportDedupRecord } from "../../../src/modules/import/domain/import-dedup.js";
import { gsi7Keys } from "../../../src/modules/subject/domain/tracked-subject.js";

const TENANT = "tenant-1";
const JOB_ID = "job-1";
const RAW_BUCKET = "raw-bucket";
const PLAN_BUCKET = "plan-bucket";
const NOW = "2026-08-23T12:00:00.000Z";

describe("parseImportJob (M11, D-042)", () => {
  let store: InMemoryImportStore;
  let subjectStore: InMemorySubjectStore;
  let objectStore: FakeImportObjectStore;
  let quota: TenantQuotaService;

  beforeEach(async () => {
    store = new InMemoryImportStore();
    subjectStore = new InMemorySubjectStore();
    objectStore = new FakeImportObjectStore();
    quota = new TenantQuotaService(new InMemoryIdentityStore(), () => NOW);

    const job: ImportJob = {
      ...importJobKey(TENANT, JOB_ID),
      entityType: "ImportJob",
      jobId: JOB_ID,
      tenantId: TENANT,
      targetEntityType: "TrackedSubject",
      status: "UPLOADED",
      createdByUserId: "user-1",
      mappingVersion: 1,
      expiresAt: "2026-08-30T12:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    };
    await store.putIfAbsent(job);
  });

  function deps() {
    return { store, subjectStore, objectStore, rawBucket: RAW_BUCKET, planBucket: PLAN_BUCKET, quota, tableName: "MainTable", now: () => NOW };
  }

  it("parses a valid CSV, writes the plan to S3, and marks the job PREVIEW_READY", async () => {
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, "displayName,type,externalId\nACME,VENDOR,ext-1\nBeta,CLIENT,\n");

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 2, rejectedRows: 0, duplicateRows: 0 });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(job?.status).toBe("PREVIEW_READY");
    expect(job?.planObjectKey).toBeTruthy();
    expect(job?.planSha256).toMatch(/^[a-f0-9]{64}$/);

    const plan = await objectStore.getObject(PLAN_BUCKET, job!.planObjectKey!);
    const lines = plan.toString("utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).action).toBe("CREATE_SUBJECT");
  });

  it("rejects structurally invalid rows without failing the whole job", async () => {
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, "displayName,type\nACME,VENDOR\n,VENDOR\n");

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 1, rejectedRows: 1, duplicateRows: 0 });
  });

  it("rejects a duplicate externalId WITHIN the same file (never both rows accepted)", async () => {
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, "displayName,type,externalId\nACME,VENDOR,ext-1\nACME2,VENDOR,ext-1\n");

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 2, acceptedRows: 1, rejectedRows: 1, duplicateRows: 0 });
  });

  it("skips a row whose externalId already exists from a PRIOR import (strong dedup)", async () => {
    await store.putIfAbsent<ImportDedupRecord>({
      ...importDedupKey(TENANT, "ext-1"),
      entityType: "ImportDedupRecord",
      tenantId: TENANT,
      externalId: "ext-1",
      subjectId: "subject-existing",
      createdAt: NOW,
    });
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, "displayName,type,externalId\nACME,VENDOR,ext-1\n");

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 1, acceptedRows: 0, rejectedRows: 0, duplicateRows: 1 });
  });

  it("skips a row with no externalId whose normalized displayName+type already exists among ACTIVE subjects (weak fallback dedup)", async () => {
    await subjectStore.putIfAbsent({
      PK: `TENANT#${TENANT}#SUBJECT#existing-1`,
      SK: "META",
      entityType: "TrackedSubject",
      subjectId: "existing-1",
      tenantId: TENANT,
      type: "VENDOR",
      displayName: "ACME Ltda",
      displayNameNormalized: "acme ltda",
      tags: [],
      status: "ACTIVE",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
      ...gsi7Keys(TENANT, "ACTIVE", "VENDOR", "acme ltda", "existing-1"),
    });
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, "displayName,type\nACME Ltda,VENDOR\n");

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "PARSED", totalRows: 1, acceptedRows: 0, rejectedRows: 0, duplicateRows: 1 });
  });

  it("is a no-op when the job is not in UPLOADED status (e.g. already parsed)", async () => {
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    await store.update<ImportJob>({ ...job!, status: "PREVIEW_READY" });

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);
    expect(outcome).toEqual({ kind: "SKIPPED_NOT_UPLOADED" });
  });

  it("fails the job when the file exceeds the row limit", async () => {
    const header = "displayName,type\n";
    const rows = Array.from({ length: 5001 }, (_, i) => `Row${i},VENDOR`).join("\n");
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, header + rows);

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);

    expect(outcome).toEqual({ kind: "FAILED", reason: "TOO_MANY_ROWS" });
    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    expect(job?.status).toBe("FAILED");
  });

  it("accepts a formula-like displayName with a warning recorded in the plan, never rejecting it", async () => {
    objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${JOB_ID}/raw.csv`, 'displayName,type\n"=SUM(A1:A2)",VENDOR\n');

    const outcome = await parseImportJob(deps(), TENANT, JOB_ID);
    expect(outcome).toEqual({ kind: "PARSED", totalRows: 1, acceptedRows: 1, rejectedRows: 0, duplicateRows: 0 });

    const job = await store.get<ImportJob>(importJobKey(TENANT, JOB_ID));
    const plan = await objectStore.getObject(PLAN_BUCKET, job!.planObjectKey!);
    const entry = JSON.parse(plan.toString("utf-8").trim());
    expect(entry.row.warnings).toEqual(["FORMULA_LIKE_VALUE"]);
  });
});
