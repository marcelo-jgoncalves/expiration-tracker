import { describe, expect, it } from "vitest";
import { startOcr, type StartOcrInput } from "../../../src/modules/extraction/application/start-ocr.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import {
  OcrDisabledError,
  TextractJobPersistenceFailedError,
  TextractUnsupportedDocumentError,
  UnsupportedDocumentTypeError,
} from "../../../src/shared/errors/app-error.js";
import type { FeatureFlags, FeatureFlagsReader } from "../../../src/modules/extraction/ports/feature-flags-reader.js";
import type {
  GetDocumentTextDetectionPage,
  StartDocumentTextDetectionInput,
  StartDocumentTextDetectionResult,
  TextractClient,
} from "../../../src/modules/extraction/ports/textract-client.js";
import type { TextractJobStore } from "../../../src/modules/extraction/ports/textract-job-store.js";
import type { TextractJob } from "../../../src/modules/extraction/domain/textract-job.js";
import type { TaskTokenEncryptor } from "../../../src/modules/extraction/ports/task-token-encryptor.js";
import { textractJobKey } from "../../../src/modules/extraction/domain/textract-job.js";

/** W3-07 fence (D-068/D-069 follow-up): quota.consume() now requires a TenantLifecycleRecord
 * to exist for the tenant ("t1" throughout this file). Synchronous helper (the fake's
 * putIfAbsent resolves synchronously) so it can be used inline. */
function seededIdentityStore(): InMemoryIdentityStore {
  const store = new InMemoryIdentityStore();
  void store.putIfAbsent({
    ...tenantLifecycleKey("t1"),
    entityType: "TenantLifecycleRecord",
    tenantId: "t1",
    status: "ACTIVE",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    version: 1,
  });
  return store;
}

class FakeFeatureFlagsReader implements FeatureFlagsReader {
  constructor(
    private readonly flags: FeatureFlags | undefined = { AI_EXTRACTION: true, OCR: true, WHATSAPP: false },
    private readonly shouldThrow = false,
  ) {}
  async getFlags(): Promise<FeatureFlags> {
    if (this.shouldThrow || !this.flags) throw new Error("appconfig unreachable");
    return this.flags;
  }
}

class FakeTextractClient implements TextractClient {
  public readonly startCalls: StartDocumentTextDetectionInput[] = [];
  constructor(
    private readonly result: StartDocumentTextDetectionResult | Error = { jobId: "job_1" },
  ) {}
  async startDocumentTextDetection(input: StartDocumentTextDetectionInput): Promise<StartDocumentTextDetectionResult> {
    this.startCalls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
  async getDocumentTextDetectionPage(): Promise<GetDocumentTextDetectionPage> {
    throw new Error("not used by startOcr");
  }
}

class FakeTextractJobStore implements TextractJobStore {
  public readonly created: TextractJob[] = [];
  private failCreateTimes: number;
  constructor(failCreateTimes = 0) {
    this.failCreateTimes = failCreateTimes;
  }
  async create(job: TextractJob): Promise<void> {
    if (this.failCreateTimes > 0) {
      this.failCreateTimes -= 1;
      throw new Error("transient dynamodb error");
    }
    this.created.push(job);
  }
  async getByJobId(): Promise<TextractJob | null> {
    return null;
  }
  async updateConditional(): Promise<boolean> {
    return true;
  }
  key(jobId: string) {
    return textractJobKey(jobId);
  }
}

class FakeTaskTokenEncryptor implements TaskTokenEncryptor {
  async encrypt(plaintext: string): Promise<string> {
    return `enc:${plaintext}`;
  }
  async decrypt(ciphertext: string): Promise<string> {
    return ciphertext.replace(/^enc:/, "");
  }
}

function baseInput(overrides: Partial<StartOcrInput> = {}): StartOcrInput {
  return {
    taskToken: "token-abc",
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    documentVersion: 3,
    runId: "run_x",
    pipelineVersion: "2026-08-01",
    cleanObject: { bucket: "clean-bucket", key: "clean/t1/item1/doc1", versionId: "v1" },
    fileName: "cert.pdf",
    ...overrides,
  };
}

describe("startOcr", () => {
  it("classifies, checks the kill switch, reserves quota, starts Textract, and persists the TextractJob without calling SendTaskSuccess", async () => {
    const jobs = new FakeTextractJobStore();
    const textract = new FakeTextractClient({ jobId: "job_1" });
    const quota = new TenantQuotaService(seededIdentityStore(), "MainTable");
    await startOcr(
      {
        featureFlags: new FakeFeatureFlagsReader(),
        quota,
        textract,
        jobs,
        tokenEncryptor: new FakeTaskTokenEncryptor(),
        snsTopicArn: "arn:sns:topic",
        snsRoleArn: "arn:iam:role",
        now: () => "2026-08-26T00:00:00.000Z",
      },
      baseInput(),
    );

    expect(textract.startCalls).toHaveLength(1);
    expect(textract.startCalls[0]?.jobTag).toBe("run_x");
    expect(jobs.created).toHaveLength(1);
    expect(jobs.created[0]?.status).toBe("STARTED");
    expect(jobs.created[0]?.taskTokenCiphertext).toBe("enc:token-abc");
  });

  it("throws UnsupportedDocumentTypeError before touching flags/quota/Textract for an unclassifiable file", async () => {
    const jobs = new FakeTextractJobStore();
    const textract = new FakeTextractClient();
    const quota = new TenantQuotaService(seededIdentityStore(), "MainTable");
    await expect(
      startOcr(
        { featureFlags: new FakeFeatureFlagsReader(), quota, textract, jobs, tokenEncryptor: new FakeTaskTokenEncryptor(), snsTopicArn: "a", snsRoleArn: "r" },
        baseInput({ fileName: "cert.docx" }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedDocumentTypeError);
    expect(textract.startCalls).toHaveLength(0);
    expect(jobs.created).toHaveLength(0);
  });

  it("throws OcrDisabledError when the OCR kill switch is off", async () => {
    const jobs = new FakeTextractJobStore();
    const textract = new FakeTextractClient();
    const quota = new TenantQuotaService(seededIdentityStore(), "MainTable");
    await expect(
      startOcr(
        {
          featureFlags: new FakeFeatureFlagsReader({ AI_EXTRACTION: true, OCR: false, WHATSAPP: false }),
          quota,
          textract,
          jobs,
          tokenEncryptor: new FakeTaskTokenEncryptor(),
          snsTopicArn: "a",
          snsRoleArn: "r",
        },
        baseInput(),
      ),
    ).rejects.toBeInstanceOf(OcrDisabledError);
    expect(textract.startCalls).toHaveLength(0);
  });

  it("fails closed (OcrDisabledError) when the feature-flags read itself throws", async () => {
    const jobs = new FakeTextractJobStore();
    const textract = new FakeTextractClient();
    const quota = new TenantQuotaService(seededIdentityStore(), "MainTable");
    await expect(
      startOcr(
        { featureFlags: new FakeFeatureFlagsReader(undefined, true), quota, textract, jobs, tokenEncryptor: new FakeTaskTokenEncryptor(), snsTopicArn: "a", snsRoleArn: "r" },
        baseInput(),
      ),
    ).rejects.toBeInstanceOf(OcrDisabledError);
  });

  it("compensates the AI_CALL quota reservation and throws TextractUnsupportedDocumentError when StartDocumentTextDetection itself fails", async () => {
    const jobs = new FakeTextractJobStore();
    const textract = new FakeTextractClient(new Error("Textract rejected the file"));
    const store = seededIdentityStore();
    const quota = new TenantQuotaService(store, "MainTable");
    await expect(
      startOcr(
        { featureFlags: new FakeFeatureFlagsReader(), quota, textract, jobs, tokenEncryptor: new FakeTaskTokenEncryptor(), snsTopicArn: "a", snsRoleArn: "r" },
        baseInput(),
      ),
    ).rejects.toBeInstanceOf(TextractUnsupportedDocumentError);

    // Quota was released - a fresh consume() for the same window should succeed again, not
    // find a stale reservation still counted against the tenant.
    await expect(
      quota.consume({ tenantId: "t1", quotaType: "AI_CALL", window: "run_x|TEXTRACT", limit: 1, windowSeconds: 1000 }),
    ).resolves.toBeUndefined();
  });

  it("treats a retried START_OCR for the same run as already-reserved instead of QuotaExceededError", async () => {
    const store = seededIdentityStore();
    const quota = new TenantQuotaService(store, "MainTable");
    const jobs1 = new FakeTextractJobStore();
    const textract1 = new FakeTextractClient({ jobId: "job_1" });
    await startOcr(
      { featureFlags: new FakeFeatureFlagsReader(), quota, textract: textract1, jobs: jobs1, tokenEncryptor: new FakeTaskTokenEncryptor(), snsTopicArn: "a", snsRoleArn: "r" },
      baseInput(),
    );

    // Second attempt for the SAME runId - must not throw QuotaExceededError, and must still
    // proceed to call Textract/persist again (Lambda-level retry semantics).
    const jobs2 = new FakeTextractJobStore();
    const textract2 = new FakeTextractClient({ jobId: "job_2" });
    await startOcr(
      { featureFlags: new FakeFeatureFlagsReader(), quota, textract: textract2, jobs: jobs2, tokenEncryptor: new FakeTaskTokenEncryptor(), snsTopicArn: "a", snsRoleArn: "r" },
      baseInput(),
    );
    expect(textract2.startCalls).toHaveLength(1);
    expect(jobs2.created).toHaveLength(1);
  });

  it("retries persisting the TextractJob locally, then throws TextractJobPersistenceFailedError once retries are exhausted", async () => {
    const jobs = new FakeTextractJobStore(5); // always fails
    const textract = new FakeTextractClient({ jobId: "job_1" });
    const quota = new TenantQuotaService(seededIdentityStore(), "MainTable");
    await expect(
      startOcr(
        { featureFlags: new FakeFeatureFlagsReader(), quota, textract, jobs, tokenEncryptor: new FakeTaskTokenEncryptor(), snsTopicArn: "a", snsRoleArn: "r", jobPersistAttempts: 2 },
        baseInput(),
      ),
    ).rejects.toBeInstanceOf(TextractJobPersistenceFailedError);
    expect(textract.startCalls).toHaveLength(1); // StartDocumentTextDetection is never retried here
  });

  it("succeeds after one transient persistence failure within the retry budget", async () => {
    const jobs = new FakeTextractJobStore(1); // fails once, then succeeds
    const textract = new FakeTextractClient({ jobId: "job_1" });
    const quota = new TenantQuotaService(seededIdentityStore(), "MainTable");
    await startOcr(
      { featureFlags: new FakeFeatureFlagsReader(), quota, textract, jobs, tokenEncryptor: new FakeTaskTokenEncryptor(), snsTopicArn: "a", snsRoleArn: "r", jobPersistAttempts: 2 },
      baseInput(),
    );
    expect(jobs.created).toHaveLength(1);
  });
});
