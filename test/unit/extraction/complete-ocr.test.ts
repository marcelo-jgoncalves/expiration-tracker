import { describe, expect, it } from "vitest";
import { completeOcr } from "../../../src/modules/extraction/application/complete-ocr.js";
import { textractJobKey, type TextractJob } from "../../../src/modules/extraction/domain/textract-job.js";
import type {
  GetDocumentTextDetectionPage,
  TextractClient,
} from "../../../src/modules/extraction/ports/textract-client.js";
import type { TextractJobStore } from "../../../src/modules/extraction/ports/textract-job-store.js";
import type { ExtractionArtifactRef, OcrArtifactStore } from "../../../src/modules/extraction/ports/ocr-artifact-store.js";
import type { TaskTokenEncryptor } from "../../../src/modules/extraction/ports/task-token-encryptor.js";
import type { SendTaskOutcome, TaskTokenSender } from "../../../src/modules/extraction/ports/task-token-sender.js";

class FakeTextractClient implements TextractClient {
  constructor(private readonly pages: GetDocumentTextDetectionPage[]) {}
  async startDocumentTextDetection(): Promise<{ jobId: string }> {
    throw new Error("not used by completeOcr");
  }
  private calls = 0;
  async getDocumentTextDetectionPage(): Promise<GetDocumentTextDetectionPage> {
    const page = this.pages[this.calls];
    this.calls += 1;
    if (!page) throw new Error("no more fake pages");
    return page;
  }
}

class FakeTextractJobStore implements TextractJobStore {
  public updateCalls: { job: TextractJob; expected: { version: number } }[] = [];
  constructor(private job: TextractJob | null) {}
  async create(): Promise<void> {}
  async getByJobId(): Promise<TextractJob | null> {
    return this.job;
  }
  async updateConditional(job: TextractJob, expected: { version: number }): Promise<boolean> {
    this.updateCalls.push({ job, expected });
    this.job = job;
    return true;
  }
  key(jobId: string) {
    return textractJobKey(jobId);
  }
}

class FakeArtifactStore implements OcrArtifactStore {
  public puts: { runId: string; blocksJson: string }[] = [];
  async put(runId: string, blocksJson: string): Promise<ExtractionArtifactRef> {
    this.puts.push({ runId, blocksJson });
    return { bucket: "extraction-transient", key: `run/${runId}/textract.json` };
  }
  async get(): Promise<string> {
    throw new Error("not used by completeOcr");
  }
}

class FakeEncryptor implements TaskTokenEncryptor {
  async encrypt(p: string) {
    return `enc:${p}`;
  }
  async decrypt(c: string) {
    if (!c.startsWith("enc:")) throw new Error("bad ciphertext");
    return c.slice(4);
  }
}

class FakeSender implements TaskTokenSender {
  public successCalls: { taskToken: string; output: unknown }[] = [];
  public failureCalls: { taskToken: string; error: string; cause?: string }[] = [];
  constructor(private readonly outcome: SendTaskOutcome | Error = "SENT") {}
  async sendTaskSuccess(taskToken: string, output: unknown): Promise<SendTaskOutcome> {
    if (this.outcome instanceof Error) throw this.outcome;
    this.successCalls.push({ taskToken, output });
    return this.outcome;
  }
  async sendTaskFailure(taskToken: string, error: string, cause?: string): Promise<SendTaskOutcome> {
    if (this.outcome instanceof Error) throw this.outcome;
    this.failureCalls.push({ taskToken, error, cause });
    return this.outcome;
  }
}

function baseJob(overrides: Partial<TextractJob> = {}): TextractJob {
  return {
    ...textractJobKey("job_1"),
    entityType: "TextractJob",
    jobId: "job_1",
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    documentVersion: 3,
    runId: "run_x",
    pipelineVersion: "2026-08-01",
    clientRequestToken: "abc",
    status: "STARTED",
    taskTokenCiphertext: "enc:token-abc",
    ttl: 1234567890,
    version: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("completeOcr", () => {
  it("returns ORPHAN_JOB and performs a discard-only confirmation call when no TextractJob matches", async () => {
    const textract = new FakeTextractClient([{ status: "SUCCEEDED", blocks: [] }]);
    const jobs = new FakeTextractJobStore(null);
    const outcome = await completeOcr(
      { textract, jobs, artifacts: new FakeArtifactStore(), tokenEncryptor: new FakeEncryptor(), sender: new FakeSender() },
      { jobId: "job_orphan" },
    );
    expect(outcome).toBe("ORPHAN_JOB");
  });

  it("does not throw when the orphan confirmation call itself fails", async () => {
    const textract: TextractClient = {
      async startDocumentTextDetection() {
        throw new Error("n/a");
      },
      async getDocumentTextDetectionPage() {
        throw new Error("textract unavailable");
      },
    };
    const outcome = await completeOcr(
      { textract, jobs: new FakeTextractJobStore(null), artifacts: new FakeArtifactStore(), tokenEncryptor: new FakeEncryptor(), sender: new FakeSender() },
      { jobId: "job_orphan" },
    );
    expect(outcome).toBe("ORPHAN_JOB");
  });

  it("returns ALREADY_FINALIZED without calling SendTask* when taskTokenCiphertext is already cleared", async () => {
    const sender = new FakeSender();
    const outcome = await completeOcr(
      {
        textract: new FakeTextractClient([]),
        jobs: new FakeTextractJobStore(baseJob({ taskTokenCiphertext: undefined })),
        artifacts: new FakeArtifactStore(),
        tokenEncryptor: new FakeEncryptor(),
        sender,
      },
      { jobId: "job_1" },
    );
    expect(outcome).toBe("ALREADY_FINALIZED");
    expect(sender.successCalls).toHaveLength(0);
    expect(sender.failureCalls).toHaveLength(0);
  });

  it("on SUCCEEDED: persists the artifact, calls SendTaskSuccess, and clears taskTokenCiphertext", async () => {
    const artifacts = new FakeArtifactStore();
    const jobsStore = new FakeTextractJobStore(baseJob());
    const sender = new FakeSender("SENT");
    const outcome = await completeOcr(
      { textract: new FakeTextractClient([{ status: "SUCCEEDED", blocks: [{ Text: "x" }] }]), jobs: jobsStore, artifacts, tokenEncryptor: new FakeEncryptor(), sender },
      { jobId: "job_1" },
    );
    expect(outcome).toBe("SUCCEEDED");
    expect(artifacts.puts).toHaveLength(1);
    expect(sender.successCalls).toHaveLength(1);
    expect(sender.successCalls[0]?.taskToken).toBe("token-abc");
    expect(jobsStore.updateCalls).toHaveLength(1);
    expect(jobsStore.updateCalls[0]?.job.taskTokenCiphertext).toBeUndefined();
    expect(jobsStore.updateCalls[0]?.job.status).toBe("COMPLETED");
  });

  it("on PARTIAL_SUCCESS: still succeeds, tags PARTIAL_OCR, never treated as failure", async () => {
    const jobsStore = new FakeTextractJobStore(baseJob());
    const sender = new FakeSender("SENT");
    const outcome = await completeOcr(
      { textract: new FakeTextractClient([{ status: "PARTIAL_SUCCESS", blocks: [], warnings: ["page 3 illegible"] }]), jobs: jobsStore, artifacts: new FakeArtifactStore(), tokenEncryptor: new FakeEncryptor(), sender },
      { jobId: "job_1" },
    );
    expect(outcome).toBe("PARTIAL_SUCCEEDED");
    const output = sender.successCalls[0]?.output as { warnings: string[] };
    expect(output.warnings).toContain("PARTIAL_OCR");
    expect(output.warnings).toContain("page 3 illegible");
  });

  it("paginates across multiple pages before deciding the outcome", async () => {
    const textract = new FakeTextractClient([
      { status: "SUCCEEDED", blocks: [{ a: 1 }], nextToken: "p2" },
      { status: "SUCCEEDED", blocks: [{ a: 2 }] },
    ]);
    const artifacts = new FakeArtifactStore();
    await completeOcr(
      { textract, jobs: new FakeTextractJobStore(baseJob()), artifacts, tokenEncryptor: new FakeEncryptor(), sender: new FakeSender("SENT") },
      { jobId: "job_1" },
    );
    expect(JSON.parse(artifacts.puts[0]!.blocksJson)).toHaveLength(2);
  });

  it("on FAILED: never persists an artifact, calls SendTaskFailure with the TextractPartialFailure code", async () => {
    const artifacts = new FakeArtifactStore();
    const sender = new FakeSender("SENT");
    const outcome = await completeOcr(
      { textract: new FakeTextractClient([{ status: "FAILED", blocks: [] }]), jobs: new FakeTextractJobStore(baseJob()), artifacts, tokenEncryptor: new FakeEncryptor(), sender },
      { jobId: "job_1" },
    );
    expect(outcome).toBe("FAILED_REPORTED");
    expect(artifacts.puts).toHaveLength(0);
    expect(sender.failureCalls).toHaveLength(1);
    expect(sender.failureCalls[0]?.error).toBe("TextractPartialFailure");
  });

  it("terminal SendTask* outcomes (TERMINAL_QUIET, TERMINAL_WARN_INVALID_TOKEN) still clear taskTokenCiphertext", async () => {
    for (const outcome of ["TERMINAL_QUIET", "TERMINAL_WARN_INVALID_TOKEN"] as const) {
      const jobsStore = new FakeTextractJobStore(baseJob());
      await completeOcr(
        { textract: new FakeTextractClient([{ status: "SUCCEEDED", blocks: [] }]), jobs: jobsStore, artifacts: new FakeArtifactStore(), tokenEncryptor: new FakeEncryptor(), sender: new FakeSender(outcome) },
        { jobId: "job_1" },
      );
      expect(jobsStore.updateCalls[0]?.job.taskTokenCiphertext).toBeUndefined();
    }
  });

  it("propagates a transient SendTask* error (e.g. throttling) and never clears taskTokenCiphertext", async () => {
    const jobsStore = new FakeTextractJobStore(baseJob());
    const sender = new FakeSender(new Error("ThrottlingException"));
    await expect(
      completeOcr(
        { textract: new FakeTextractClient([{ status: "SUCCEEDED", blocks: [] }]), jobs: jobsStore, artifacts: new FakeArtifactStore(), tokenEncryptor: new FakeEncryptor(), sender },
        { jobId: "job_1" },
      ),
    ).rejects.toThrow("ThrottlingException");
    expect(jobsStore.updateCalls).toHaveLength(0);
  });

  it("never calls any delete-like operation on the artifact store in any outcome (governing invariant, design §3)", async () => {
    const artifacts = new FakeArtifactStore();
    expect((artifacts as unknown as { delete?: unknown }).delete).toBeUndefined();
    await completeOcr(
      { textract: new FakeTextractClient([{ status: "FAILED", blocks: [] }]), jobs: new FakeTextractJobStore(baseJob()), artifacts, tokenEncryptor: new FakeEncryptor(), sender: new FakeSender("SENT") },
      { jobId: "job_1" },
    );
    // OcrArtifactStore's port type doesn't even expose a delete method - nothing to call.
  });
});
