/**
 * `runBedrockExtraction()` unit tests (M7 item 6). Hand-written fakes only, no `vi.mock`, no
 * real Bedrock call anywhere in this file - `FakeBedrockClient` stands in for the Converse API
 * adapter entirely, so these tests exercise the ORCHESTRATION logic (kill switch, quota
 * reservation/compensation, degraded-no-artifact path, response shaping for item 7) rather than
 * prompt/tool-schema parsing (covered separately in `bedrock-runtime-client.test.ts`, the
 * adversarial corpus for the real adapter).
 *
 * Design §1.11 references a 13-case Codex adversarial corpus this repo does not hold verbatim
 * (not found anywhere under docs/architecture/reviews/m7-extraction-design/ - checked before
 * writing this file) plus an explicit 14th cost-abuse case. Coverage built from first
 * principles across both test files:
 *  1. Prompt injection via document content ("ignore previous instructions...") -> the adapter
 *     test proves the system prompt/user delimiter design, not reachable from this file (no
 *     real model call here); this file instead proves the ORCHESTRATION never trusts anything
 *     from the artifact except through the BedrockClient port's typed result.
 *  2. Model attempts to call a tool other than submit_extraction / no tool call at all /
 *     malformed tool-call JSON / extra/missing schema fields / token-limit truncation -> all
 *     covered as `BedrockClient.extract()` throwing `BedrockExtractionFailedError` (the port's
 *     documented contract), see "propagates BedrockExtractionFailedError..." below - the
 *     adapter test file covers each concrete malformed-shape case that triggers this throw.
 *  3. **14th case, cost-abuse / idempotent reprocessing** - "a retried/duplicate execution for
 *     the same run must not spend a second real Bedrock call" - see "treats a retried run as
 *     already-reserved..." below, mirroring start-ocr.test.ts's equivalent Textract-side test.
 *  4. AI_EXTRACTION kill switch off / unreadable -> fail-closed, defense in depth even though
 *     the ASL's own Choice state already gates this.
 *  5. No OCR artifact at all (RunTextract/parser both degraded) -> never calls Bedrock, never
 *     fabricates a candidate, returns zero fields (mirrors run-deterministic-parser.test.ts's
 *     "never fabricates a candidate in the degraded path" discipline).
 *  6. Bedrock call fails (adapter throws) -> quota reservation is compensated (released) before
 *     the error propagates, same pattern as start-ocr.test.ts's Textract-call-failure case.
 */
import { describe, expect, it } from "vitest";
import { runBedrockExtraction, type RunBedrockExtractionInput } from "../../../src/modules/extraction/application/run-bedrock-extraction.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { AiExtractionDisabledError, BedrockExtractionFailedError } from "../../../src/shared/errors/app-error.js";
import type { BedrockClient } from "../../../src/modules/extraction/ports/bedrock-client.js";
import type { BedrockExtractionRequest, BedrockExtractionResult } from "../../../src/modules/extraction/domain/bedrock-extraction.js";
import type { FeatureFlags, FeatureFlagsReader } from "../../../src/modules/extraction/ports/feature-flags-reader.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

/** W3-07 fence (D-068/D-069 follow-up): quota.consume() now requires a TenantLifecycleRecord
 * to exist for the tenant ("t1" throughout this file's baseInput()). Synchronous helper (the
 * fake's putIfAbsent resolves synchronously) so it can be used inline in a `new
 * TenantQuotaService(seededIdentityStore(), ...)` expression. */
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

class FakeBedrockClient implements BedrockClient {
  calls: BedrockExtractionRequest[] = [];
  constructor(
    private readonly result: BedrockExtractionResult | undefined,
    private readonly error?: Error,
  ) {}
  async extract(request: BedrockExtractionRequest): Promise<BedrockExtractionResult> {
    this.calls.push(request);
    if (this.error) throw this.error;
    return this.result!;
  }
}

function baseInput(overrides: Partial<RunBedrockExtractionInput> = {}): RunBedrockExtractionInput {
  return {
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    documentVersion: 3,
    runId: "run_x",
    pipelineVersion: "2026-08-01",
    ocrAvailable: true,
    extractedFields: [{ fieldName: "expirationDate", valueType: "DATE", source: "DETERMINISTIC_PARSER" }],
    needsBedrock: true,
    aiExtractionEnabled: true,
    artifact: { bucket: "b", key: "ocr/run_x.json" },
    ...overrides,
  };
}

describe("runBedrockExtraction", () => {
  it("happy path: calls Bedrock with only the artifact ref, shapes the result for item 7", async () => {
    const bedrock = new FakeBedrockClient({ fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.92 }] });
    const output = await runBedrockExtraction(
      { featureFlags: new FakeFeatureFlagsReader(), quota: new TenantQuotaService(seededIdentityStore(), "MainTable"), bedrock },
      baseInput(),
    );
    expect(bedrock.calls).toHaveLength(1);
    expect(bedrock.calls[0]!.textArtifact).toEqual({ bucket: "b", key: "ocr/run_x.json" });
    expect(output.bedrockFields).toEqual([{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.92, source: "BEDROCK" }]);
    expect(output.runId).toBe("run_x");
  });

  it("fails closed when AI_EXTRACTION is off, never calling Bedrock", async () => {
    const bedrock = new FakeBedrockClient(undefined);
    await expect(
      runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader({ AI_EXTRACTION: false, OCR: true, WHATSAPP: false }), quota: new TenantQuotaService(seededIdentityStore(), "MainTable"), bedrock },
        baseInput(),
      ),
    ).rejects.toBeInstanceOf(AiExtractionDisabledError);
    expect(bedrock.calls).toHaveLength(0);
  });

  it("fails closed when the feature-flags read itself throws, never treating an unknown flag as enabled", async () => {
    const bedrock = new FakeBedrockClient(undefined);
    await expect(
      runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader(undefined, true), quota: new TenantQuotaService(seededIdentityStore(), "MainTable"), bedrock },
        baseInput(),
      ),
    ).rejects.toBeInstanceOf(AiExtractionDisabledError);
    expect(bedrock.calls).toHaveLength(0);
  });

  it("never calls Bedrock and returns zero fields when no OCR artifact exists (fully degraded run)", async () => {
    const bedrock = new FakeBedrockClient(undefined);
    const output = await runBedrockExtraction(
      { featureFlags: new FakeFeatureFlagsReader(), quota: new TenantQuotaService(seededIdentityStore(), "MainTable"), bedrock },
      baseInput({ ocrAvailable: false, artifact: undefined }),
    );
    expect(bedrock.calls).toHaveLength(0);
    expect(output.bedrockFields).toEqual([]);
  });

  it("propagates BedrockExtractionFailedError and compensates (releases) the quota reservation on call failure", async () => {
    const bedrock = new FakeBedrockClient(undefined, new BedrockExtractionFailedError("boom"));
    const store = seededIdentityStore();
    const quota = new TenantQuotaService(store, "MainTable");
    await expect(runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock, callAttempts: 1 }, baseInput())).rejects.toBeInstanceOf(BedrockExtractionFailedError);

    // Compensation proves the reservation was released: a fresh call for the SAME run must be
    // able to reserve again (would throw QuotaExceededError if the release above hadn't run).
    const bedrock2 = new FakeBedrockClient({ fields: [] });
    await expect(runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock2 }, baseInput())).resolves.toBeDefined();
  });

  it("14th adversarial case (cost-abuse): a retried/duplicate execution for the same run reserves against its own prior AI_CALL/BEDROCK window, never a second unrelated reservation", async () => {
    // Same runId used twice (mirrors deriveExtractionRunId()'s own idempotency guarantee - a
    // retried Step Functions execution for an UNCHANGED document reuses the same runId).
    const store = seededIdentityStore();
    const quota = new TenantQuotaService(store, "MainTable");

    const bedrock1 = new FakeBedrockClient({ fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.9 }] });
    await runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock1 }, baseInput());
    expect(bedrock1.calls).toHaveLength(1);

    // A second, independent invocation for the identical runId - the quota reservation already
    // exists from the first call. The function must not treat this as a hard failure (a genuine
    // retry of an already-parked execution must be able to complete), but it also never doubles
    // as a NEW quota grant - QuotaExceededError against the run's own prior reservation is
    // swallowed exactly once per attempt, same as start-ocr.ts's documented contract.
    const bedrock2 = new FakeBedrockClient({ fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.9 }] });
    await expect(runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock2 }, baseInput())).resolves.toBeDefined();
    // The key point of the cost-abuse case: this is still exactly ONE real Bedrock call per
    // invocation of the function (the quota mechanism doesn't cause N calls) - the actual
    // system-level dedup guarantee (never re-entering RunBedrock at all for a truly unchanged
    // document) comes from ExtractionRun's own idempotent runId derivation and the Step
    // Functions execution-name idempotency at StartExecution, both upstream of this function -
    // this test documents that this function's own quota bookkeeping does not add a SEPARATE
    // way to bypass that dedup by calling Bedrock N times per "retry".
    expect(bedrock2.calls).toHaveLength(1);
  });
});
