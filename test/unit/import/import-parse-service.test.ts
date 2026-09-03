import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryImportStore, FakeImportObjectStore } from "./in-memory-store.js";
import { InMemorySubjectStore } from "../subject/in-memory-store.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { parseImportJob } from "../../../src/modules/import/application/import-parse-service.js";
import { importJobKey, buildImportJobClaim, DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING, type ImportJob } from "../../../src/modules/import/domain/import-job.js";
import { importDedupKey, type ImportDedupRecord } from "../../../src/modules/import/domain/import-dedup.js";
import { gsi7Keys } from "../../../src/modules/subject/domain/tracked-subject.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

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
    const identityStore = new InMemoryIdentityStore();
    // W3-07 fence (D-068/D-069 follow-up): quota.consume() (IMPORT_ROWS et al) now requires a
    // TenantLifecycleRecord to exist for the tenant.
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
      targetEntityType: "TrackedSubject",
      status: "UPLOADED",
      createdByUserId: "user-1",
      columnMapping: DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING,
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

  // D-192 §3 (AWAITING_MAPPING orchestration) - the new state only ever applies to a job whose
  // `columnMapping` is not yet known (Document/Requirement, POST /mapping is a future slice).
  // `TrackedSubject` jobs created via `ImportService.reserveImport()` always carry
  // `DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING` already (asserted by every test above still going
  // straight UPLOADED->PARSED, unchanged) - these tests exercise a job constructed WITHOUT a
  // mapping, exactly the shape a future Document/Requirement `reserveImport` call would produce.
  describe("D-192: AWAITING_MAPPING orchestration", () => {
    const UNMAPPED_JOB_ID = "job-unmapped";

    async function seedUnmappedJob(overrides: Partial<ImportJob> = {}): Promise<void> {
      const job: ImportJob = {
        ...importJobKey(TENANT, UNMAPPED_JOB_ID),
        entityType: "ImportJob",
        jobId: UNMAPPED_JOB_ID,
        tenantId: TENANT,
        targetEntityType: "Document",
        status: "UPLOADED",
        createdByUserId: "user-1",
        // columnMapping intentionally absent - not yet supplied via POST /mapping.
        expiresAt: "2026-08-30T12:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW,
        version: 1,
        ...overrides,
      };
      await store.putIfAbsent(job);
    }

    it("a job with no columnMapping moves UPLOADED -> AWAITING_MAPPING instead of PARSING, never reading S3", async () => {
      await seedUnmappedJob();

      const outcome = await parseImportJob(deps(), TENANT, UNMAPPED_JOB_ID);

      expect(outcome).toEqual({ kind: "AWAITING_MAPPING" });
      const job = await store.get<ImportJob>(importJobKey(TENANT, UNMAPPED_JOB_ID));
      expect(job?.status).toBe("AWAITING_MAPPING");
      expect(job?.version).toBe(2);
    });

    it("a job already AWAITING_MAPPING with no columnMapping stays put (no-op, no re-claim)", async () => {
      await seedUnmappedJob({ status: "AWAITING_MAPPING" });

      const outcome = await parseImportJob(deps(), TENANT, UNMAPPED_JOB_ID);

      expect(outcome).toEqual({ kind: "AWAITING_MAPPING" });
      const job = await store.get<ImportJob>(importJobKey(TENANT, UNMAPPED_JOB_ID));
      expect(job?.status).toBe("AWAITING_MAPPING");
      expect(job?.version).toBe(1); // untouched - no claim attempted since nothing to transition.
    });

    it("a job in AWAITING_MAPPING WITH a columnMapping now present moves straight to PARSING (POST /mapping's eventual effect)", async () => {
      await seedUnmappedJob({ status: "AWAITING_MAPPING", columnMapping: DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING, targetEntityType: "TrackedSubject" });
      objectStore.seed(RAW_BUCKET, `tenant/${TENANT}/imports/${UNMAPPED_JOB_ID}/raw.csv`, "displayName,type\nACME,VENDOR\n");

      const outcome = await parseImportJob(deps(), TENANT, UNMAPPED_JOB_ID);

      expect(outcome).toEqual({ kind: "PARSED", totalRows: 1, acceptedRows: 1, rejectedRows: 0, duplicateRows: 0 });
      const job = await store.get<ImportJob>(importJobKey(TENANT, UNMAPPED_JOB_ID));
      expect(job?.status).toBe("PREVIEW_READY");
    });

    // G-V3: adversarial test - proves the OCC claim genuinely rejects a stale/concurrent
    // double-transition rather than silently letting both callers "win". Without
    // `buildImportJobClaim`'s conditional TransactWriteItems (i.e. reverting to the old
    // unconditioned `store.update()` Put this replaced), BOTH calls below would report
    // AWAITING_MAPPING and this test would fail on the second assertion.
    it("G-V3: two concurrent parse triggers racing the SAME stale read only let ONE claim AWAITING_MAPPING - the loser is rejected by OCC, never double-transitions", async () => {
      await seedUnmappedJob();
      // Both callers read the SAME pre-claim snapshot (version 1, status UPLOADED) before either
      // one's claim lands - simulates the S3-event trigger and a concurrent redelivery racing.
      const staleJob = await store.get<ImportJob>(importJobKey(TENANT, UNMAPPED_JOB_ID));
      expect(staleJob?.version).toBe(1);

      const [first, second] = await Promise.all([parseImportJob(deps(), TENANT, UNMAPPED_JOB_ID), parseImportJob(deps(), TENANT, UNMAPPED_JOB_ID)]);

      const outcomes = [first, second].map((o) => o.kind).sort();
      expect(outcomes).toEqual(["AWAITING_MAPPING", "SKIPPED_ALREADY_CLAIMED"]);

      const job = await store.get<ImportJob>(importJobKey(TENANT, UNMAPPED_JOB_ID));
      expect(job?.status).toBe("AWAITING_MAPPING");
      expect(job?.version).toBe(2); // claimed exactly once, never twice.
    });

    it("a stale caller that already observed an old version is rejected by the claim even though the row has since moved on (direct OCC proof on the claim builder itself)", async () => {
      await seedUnmappedJob();
      // First caller claims AWAITING_MAPPING for real (version 1 -> 2).
      const firstOutcome = await parseImportJob(deps(), TENANT, UNMAPPED_JOB_ID);
      expect(firstOutcome).toEqual({ kind: "AWAITING_MAPPING" });

      // A second, STALE caller still holds the pre-claim version (1) and status (UPLOADED) -
      // its own claim attempt must be rejected by OCC (version no longer matches), never
      // silently re-applied on top of the row that already moved to AWAITING_MAPPING.
      await expect(
        store.transactWrite([
          buildImportJobClaim({
            tableName: "MainTable",
            tenantId: TENANT,
            jobId: UNMAPPED_JOB_ID,
            expectedVersion: 1,
            fromStatus: "UPLOADED",
            toStatus: "AWAITING_MAPPING",
          }),
        ]),
      ).rejects.toThrow(/TransactionCanceledException/);

      const job = await store.get<ImportJob>(importJobKey(TENANT, UNMAPPED_JOB_ID));
      expect(job?.status).toBe("AWAITING_MAPPING");
      expect(job?.version).toBe(2);
    });
  });
});
