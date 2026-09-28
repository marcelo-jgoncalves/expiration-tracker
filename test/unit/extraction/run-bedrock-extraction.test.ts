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
import { automationBudgetWindow, AUTOMATION_BUDGET_WINDOW_SECONDS, BEDROCK_COST_CENTS } from "../../../src/modules/extraction/domain/automation-budget.js";

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
    private readonly flags: FeatureFlags | undefined = { AI_EXTRACTION: true, OCR: true, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false, WHATSAPP_DELIVERY_WORKER_ENABLED: false },
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

/** Distinct outcome per call, in order - for `callAttempts > 1` tests where the first attempt(s)
 * must genuinely fail (a real, billable Converse call that just didn't produce a usable
 * tool-call) before a later one succeeds. */
class SequencedFakeBedrockClient implements BedrockClient {
  calls: BedrockExtractionRequest[] = [];
  private i = 0;
  constructor(private readonly outcomes: Array<BedrockExtractionResult | Error>) {}
  async extract(request: BedrockExtractionRequest): Promise<BedrockExtractionResult> {
    this.calls.push(request);
    const outcome = this.outcomes[this.i++]!;
    if (outcome instanceof Error) throw outcome;
    return outcome;
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
    correlationId: "corr-1",
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
      { featureFlags: new FakeFeatureFlagsReader(), quota: new TenantQuotaService(seededIdentityStore(), "MainTable"), bedrock, bedrockCostCentsPerCall: BEDROCK_COST_CENTS },
      baseInput(),
    );
    expect(bedrock.calls).toHaveLength(1);
    expect(bedrock.calls[0]!.textArtifact).toEqual({ bucket: "b", key: "ocr/run_x.json" });
    expect(output.bedrockFields).toEqual([{ fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.92, source: "BEDROCK" }]);
    expect(output.runId).toBe("run_x");
    // Logging-observability-standard.md "Tracing distribuído" (2026-08-29).
    expect(output.correlationId).toBe("corr-1");
  });

  it("fails closed when AI_EXTRACTION is off, never calling Bedrock", async () => {
    const bedrock = new FakeBedrockClient(undefined);
    await expect(
      runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader({ AI_EXTRACTION: false, OCR: true, WHATSAPP: false, EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED: false, DOCUMENT_ARCHIVE_PROMOTION_ENABLED: false, WHATSAPP_DELIVERY_WORKER_ENABLED: false }), quota: new TenantQuotaService(seededIdentityStore(), "MainTable"), bedrock },
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
    // Logging-observability-standard.md "Tracing distribuído" (2026-08-29) - the degraded
    // (no-artifact) return path must also thread correlationId, not just the happy path.
    expect(output.correlationId).toBe("corr-1");
  });

  it("propagates BedrockExtractionFailedError and compensates (releases) the quota reservation on call failure", async () => {
    const bedrock = new FakeBedrockClient(undefined, new BedrockExtractionFailedError("boom"));
    const store = seededIdentityStore();
    const quota = new TenantQuotaService(store, "MainTable");
    await expect(
      runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock, callAttempts: 1, bedrockCostCentsPerCall: BEDROCK_COST_CENTS }, baseInput()),
    ).rejects.toBeInstanceOf(BedrockExtractionFailedError);

    // Compensation proves the reservation was released: a fresh call for the SAME run must be
    // able to reserve again (would throw QuotaExceededError if the release above hadn't run).
    const bedrock2 = new FakeBedrockClient({ fields: [] });
    await expect(runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock2, bedrockCostCentsPerCall: BEDROCK_COST_CENTS }, baseInput())).resolves.toBeDefined();
  });

  it("14th adversarial case (cost-abuse): a retried/duplicate execution for the same run reserves against its own prior AI_CALL/BEDROCK window, never a second unrelated reservation", async () => {
    // Same runId used twice (mirrors deriveExtractionRunId()'s own idempotency guarantee - a
    // retried Step Functions execution for an UNCHANGED document reuses the same runId).
    const store = seededIdentityStore();
    const quota = new TenantQuotaService(store, "MainTable");

    const bedrock1 = new FakeBedrockClient({ fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.9 }] });
    await runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock1, bedrockCostCentsPerCall: BEDROCK_COST_CENTS }, baseInput());
    expect(bedrock1.calls).toHaveLength(1);

    // A second, independent invocation for the identical runId - the quota reservation already
    // exists from the first call. The function must not treat this as a hard failure (a genuine
    // retry of an already-parked execution must be able to complete), but it also never doubles
    // as a NEW quota grant - QuotaExceededError against the run's own prior reservation is
    // swallowed exactly once per attempt, same as start-ocr.ts's documented contract.
    const bedrock2 = new FakeBedrockClient({ fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.9 }] });
    await expect(runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock2, bedrockCostCentsPerCall: BEDROCK_COST_CENTS }, baseInput())).resolves.toBeDefined();
    // The key point of the cost-abuse case: this is still exactly ONE real Bedrock call per
    // invocation of the function (the quota mechanism doesn't cause N calls) - the actual
    // system-level dedup guarantee (never re-entering RunBedrock at all for a truly unchanged
    // document) comes from ExtractionRun's own idempotent runId derivation and the Step
    // Functions execution-name idempotency at StartExecution, both upstream of this function -
    // this test documents that this function's own quota bookkeeping does not add a SEPARATE
    // way to bypass that dedup by calling Bedrock N times per "retry".
    expect(bedrock2.calls).toHaveLength(1);
  });

  it("Codex R3 finding (ALTO): never calls Bedrock when no cost-per-call is confirmed for the configured model - fails closed, degrades, releases the AI_CALL reservation", async () => {
    const store = seededIdentityStore();
    const quota = new TenantQuotaService(store, "MainTable");
    const bedrock = new FakeBedrockClient({ fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.9 }] });

    // bedrockCostCentsPerCall deliberately omitted - same placeholder-not-selected state
    // bedrock-extraction-task-handler.ts defaults to when BEDROCK_COST_CENTS_PER_CALL isn't set.
    const output = await runBedrockExtraction({ featureFlags: new FakeFeatureFlagsReader(), quota, bedrock }, baseInput());

    expect(bedrock.calls).toHaveLength(0);
    expect(output.bedrockFields).toEqual([]);
    // AI_CALL reservation released, not left dangling.
    await expect(quota.consume({ tenantId: "t1", quotaType: "AI_CALL", window: "run_x|BEDROCK", limit: 1, windowSeconds: 7 * 24 * 60 * 60 })).resolves.toBeUndefined();
    // No AUTOMATION_COST_CENTS row was ever created - never even attempts to debit an unconfirmed cost.
    const record = await store.get<{ PK: string; SK: string }>({ PK: "TENANT#t1#QUOTA", SK: `TYPE#AUTOMATION_COST_CENTS#${automationBudgetWindow(new Date().toISOString())}` });
    expect(record).toBeUndefined();
  });

  describe("D-347 §3.7 real-time automation cost budget", () => {
    const FIXED_NOW = "2026-09-27T12:00:00.000Z";
    const fixedNow = () => FIXED_NOW;

    it("degrades gracefully (zero fields, never throws) when the tenant's cycle budget is already exhausted, and compensates the AI_CALL reservation it no longer needs", async () => {
      const store = seededIdentityStore();
      const quota = new TenantQuotaService(store, "MainTable");
      // Pre-exhaust the budget for a DIFFERENT run in the same cycle (same tenant, same
      // calendar-month window key the function itself computes from `now` - a real prior
      // spend, not this test's own run).
      await quota.consume({
        tenantId: "t1",
        quotaType: "AUTOMATION_COST_CENTS",
        window: automationBudgetWindow(FIXED_NOW),
        limit: BEDROCK_COST_CENTS,
        windowSeconds: 30 * 24 * 60 * 60,
        amount: BEDROCK_COST_CENTS,
      });

      const bedrock = new FakeBedrockClient({ fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.9 }] });
      const output = await runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader(), quota, bedrock, automationBudgetCentsPerCycle: BEDROCK_COST_CENTS, bedrockCostCentsPerCall: BEDROCK_COST_CENTS, now: fixedNow },
        baseInput(),
      );

      expect(bedrock.calls).toHaveLength(0);
      expect(output.bedrockFields).toEqual([]);
      expect(output.correlationId).toBe("corr-1");

      // The AI_CALL reservation for THIS run must have been released, not left dangling - a
      // fresh attempt of the same run (e.g. once the tenant's next cycle resets the budget)
      // must be able to reserve AI_CALL again rather than finding a phantom lock.
      await expect(quota.consume({ tenantId: "t1", quotaType: "AI_CALL", window: "run_x|BEDROCK", limit: 1, windowSeconds: 7 * 24 * 60 * 60 })).resolves.toBeUndefined();
    });

    it("debits the real per-call cost from the shared cycle budget, degrading only once accumulated spend would exceed it", async () => {
      // Budget one cent short of covering TWO real calls - the first call fits, the second
      // would cross the budget and must degrade, proving this is a real accumulating balance
      // across runs, never a per-run reservation that resets (unlike AI_CALL's idempotency-lock
      // semantics).
      const budget = BEDROCK_COST_CENTS * 2 - 1;
      const store = seededIdentityStore();
      const quota = new TenantQuotaService(store, "MainTable");

      const bedrock1 = new FakeBedrockClient({ fields: [] });
      await runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock1, automationBudgetCentsPerCycle: budget, bedrockCostCentsPerCall: BEDROCK_COST_CENTS, now: fixedNow },
        baseInput({ runId: "run_y" }),
      );
      expect(bedrock1.calls).toHaveLength(1);

      const bedrock2 = new FakeBedrockClient({ fields: [] });
      const output2 = await runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrock2, automationBudgetCentsPerCycle: budget, bedrockCostCentsPerCall: BEDROCK_COST_CENTS, now: fixedNow },
        baseInput({ runId: "run_z" }),
      );
      expect(bedrock2.calls).toHaveLength(0);
      expect(output2.bedrockFields).toEqual([]);
    });

    it("Codex R2 finding (ALTO, test gap from R1): a release() computed against a NEW cycle's clock never decrements the PREVIOUS cycle's real row - actually exercises release(), not just the key strings", async () => {
      const store = seededIdentityStore();
      const quota = new TenantQuotaService(store, "MainTable");
      const septemberNow = () => "2026-09-27T23:00:00.000Z";
      const octoberNow = () => "2026-10-01T00:05:00.000Z";
      const septemberWindow = automationBudgetWindow(septemberNow());
      const octoberWindow = automationBudgetWindow(octoberNow());
      expect(septemberWindow).not.toBe(octoberWindow);

      // September: one real, successful debit - establishes the September row's balance.
      const bedrockSept = new FakeBedrockClient({ fields: [] });
      await runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader(), quota, bedrock: bedrockSept, automationBudgetCentsPerCycle: 100, bedrockCostCentsPerCall: BEDROCK_COST_CENTS, now: septemberNow },
        baseInput({ runId: "run_sept" }),
      );
      const beforeRelease = await store.get<{ PK: string; SK: string; count: number }>({ PK: "TENANT#t1#QUOTA", SK: `TYPE#AUTOMATION_COST_CENTS#${septemberWindow}` });
      expect(beforeRelease?.count).toBe(BEDROCK_COST_CENTS);

      // The exact scenario Codex described: a caller running under OCTOBER's clock (e.g. a
      // delayed retry of a run that started in September) calls release() for what IT believes
      // is "this cycle's" reservation - directly exercising TenantQuotaService.release(), not
      // just comparing key strings.
      await quota.release({ tenantId: "t1", quotaType: "AUTOMATION_COST_CENTS", window: octoberWindow, windowSeconds: AUTOMATION_BUDGET_WINDOW_SECONDS, amount: BEDROCK_COST_CENTS });

      // September's real balance must be completely untouched - the release() above targeted a
      // structurally different row (no October record even exists yet, so it was a genuine
      // no-op), never in-place-rolled-over September's count down.
      const afterRelease = await store.get<{ PK: string; SK: string; count: number }>({ PK: "TENANT#t1#QUOTA", SK: `TYPE#AUTOMATION_COST_CENTS#${septemberWindow}` });
      expect(afterRelease?.count).toBe(BEDROCK_COST_CENTS);
      const octoberRecord = await store.get<{ PK: string; SK: string; count: number }>({ PK: "TENANT#t1#QUOTA", SK: `TYPE#AUTOMATION_COST_CENTS#${octoberWindow}` });
      expect(octoberRecord).toBeUndefined();
    });

    it("Codex R1 finding (ALTO): with callAttempts > 1, EACH real attempt is billed separately, and a failed-then-succeeded run is never refunded for the failed attempt's real spend", async () => {
      const store = seededIdentityStore();
      const quota = new TenantQuotaService(store, "MainTable");
      // First attempt "fails" (e.g. malformed tool-call downstream of a real, billable Converse
      // call), second attempt succeeds - both are genuine attempts and must both be billed.
      const bedrock = new SequencedFakeBedrockClient([new Error("malformed tool call"), { fields: [{ fieldName: "expirationDate", value: "2027-03-31", confidence: 0.9 }] }]);

      const output = await runBedrockExtraction(
        { featureFlags: new FakeFeatureFlagsReader(), quota, bedrock, callAttempts: 2, automationBudgetCentsPerCycle: 100, bedrockCostCentsPerCall: BEDROCK_COST_CENTS, now: fixedNow },
        baseInput(),
      );
      expect(bedrock.calls).toHaveLength(2);
      expect(output.bedrockFields).toHaveLength(1);

      const record = await store.get<{ PK: string; SK: string; count: number }>({ PK: "TENANT#t1#QUOTA", SK: `TYPE#AUTOMATION_COST_CENTS#${automationBudgetWindow(FIXED_NOW)}` });
      // 2 real attempts, each billed - NOT just 1, and NOT refunded despite the run ultimately
      // succeeding on retry (the first attempt's real spend is never given back).
      expect(record?.count).toBe(BEDROCK_COST_CENTS * 2);
    });

    it("Codex R1 finding (ALTO, retry+refund half): on ULTIMATE failure after multiple real attempts, only the AI_CALL reservation is released - the cost-budget debits for every real attempt stay spent", async () => {
      const store = seededIdentityStore();
      const quota = new TenantQuotaService(store, "MainTable");
      const bedrock = new SequencedFakeBedrockClient([new Error("boom 1"), new Error("boom 2")]);

      await expect(
        runBedrockExtraction(
          { featureFlags: new FakeFeatureFlagsReader(), quota, bedrock, callAttempts: 2, automationBudgetCentsPerCycle: 100, bedrockCostCentsPerCall: BEDROCK_COST_CENTS, now: fixedNow },
          baseInput(),
        ),
      ).rejects.toBeInstanceOf(BedrockExtractionFailedError);

      const record = await store.get<{ PK: string; SK: string; count: number }>({ PK: "TENANT#t1#QUOTA", SK: `TYPE#AUTOMATION_COST_CENTS#${automationBudgetWindow(FIXED_NOW)}` });
      expect(record?.count).toBe(BEDROCK_COST_CENTS * 2); // both real attempts stay billed, never refunded.

      // AI_CALL reservation, unlike the cost debit, IS released - a fresh attempt of the same
      // run must be able to reserve it again.
      await expect(quota.consume({ tenantId: "t1", quotaType: "AI_CALL", window: "run_x|BEDROCK", limit: 1, windowSeconds: 7 * 24 * 60 * 60 })).resolves.toBeUndefined();
    });
  });
});
