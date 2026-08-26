import { describe, expect, it } from "vitest";
import { runDeterministicParser, type RunDeterministicParserInput } from "../../../src/modules/extraction/application/run-deterministic-parser.js";
import { DeterministicParserFailedError } from "../../../src/shared/errors/app-error.js";
import type { OcrArtifactStore, ExtractionArtifactRef } from "../../../src/modules/extraction/ports/ocr-artifact-store.js";
import type { FeatureFlags, FeatureFlagsReader } from "../../../src/modules/extraction/ports/feature-flags-reader.js";

class FakeArtifactStore implements OcrArtifactStore {
  constructor(private readonly stored: Record<string, string> = {}) {}
  async put(): Promise<ExtractionArtifactRef> {
    throw new Error("not used by runDeterministicParser");
  }
  async get(ref: ExtractionArtifactRef): Promise<string> {
    const value = this.stored[ref.key];
    if (value === undefined) throw new Error(`no artifact at ${ref.key}`);
    return value;
  }
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

function baseInput(overrides: Partial<RunDeterministicParserInput> = {}): RunDeterministicParserInput {
  return {
    tenantId: "t1",
    itemId: "item1",
    documentId: "doc1",
    documentVersion: 3,
    runId: "run_x",
    pipelineVersion: "2026-08-01",
    ...overrides,
  };
}

function textractBlocks(lines: string[]): string {
  return JSON.stringify(lines.map((Text) => ({ BlockType: "LINE", Text })));
}

describe("runDeterministicParser", () => {
  it("happy path: finds a confident candidate, does not need Bedrock, reports AI_EXTRACTION flag", async () => {
    const artifacts = new FakeArtifactStore({ "ocr/run_x.json": textractBlocks(["Contrato XYZ", "Validade: 31/03/2027"]) });
    const featureFlags = new FakeFeatureFlagsReader({ AI_EXTRACTION: true, OCR: true, WHATSAPP: false });
    const output = await runDeterministicParser(
      { artifacts, featureFlags },
      baseInput({ ocrAvailable: true, artifact: { bucket: "b", key: "ocr/run_x.json" } }),
    );
    expect(output.ocrAvailable).toBe(true);
    expect(output.needsBedrock).toBe(false);
    expect(output.aiExtractionEnabled).toBe(true);
    expect(output.extractedFields).toEqual([
      { fieldName: "expirationDate", valueType: "DATE", candidateValue: "2027-03-31", confidence: 0.9, source: "DETERMINISTIC_PARSER" },
    ]);
    // Original run identity is preserved on the output (needed by every later ASL state).
    expect(output.tenantId).toBe("t1");
    expect(output.runId).toBe("run_x");
  });

  it("degraded path (RunTextract failed, no artifact): needs Bedrock, never fabricates a candidate", async () => {
    const artifacts = new FakeArtifactStore();
    const featureFlags = new FakeFeatureFlagsReader();
    const output = await runDeterministicParser({ artifacts, featureFlags }, baseInput());
    expect(output.ocrAvailable).toBe(false);
    expect(output.extractedFields).toEqual([
      { fieldName: "expirationDate", valueType: "DATE", candidateValue: undefined, confidence: undefined, source: "DETERMINISTIC_PARSER" },
    ]);
    expect(output.needsBedrock).toBe(true);
  });

  it("weak deterministic candidate (below threshold) still needs Bedrock", async () => {
    const artifacts = new FakeArtifactStore({ "k": textractBlocks(["Documento emitido em 10/01/2026, sem outra menção."]) });
    const featureFlags = new FakeFeatureFlagsReader();
    const output = await runDeterministicParser({ artifacts, featureFlags }, baseInput({ ocrAvailable: true, artifact: { bucket: "b", key: "k" } }));
    expect(output.extractedFields[0]?.confidence).toBe(0.5);
    expect(output.needsBedrock).toBe(true);
  });

  it("real OCR ambiguity (2+ distinct candidates) needs Bedrock even with a confident best candidate", async () => {
    const artifacts = new FakeArtifactStore({ "k": textractBlocks(["Emitido 10/01/2026.", "Validade: 31/03/2027."]) });
    const featureFlags = new FakeFeatureFlagsReader();
    const output = await runDeterministicParser({ artifacts, featureFlags }, baseInput({ ocrAvailable: true, artifact: { bucket: "b", key: "k" } }));
    expect(output.needsBedrock).toBe(true);
  });

  it("fail-closed: a feature-flags read error reports aiExtractionEnabled=false, never throws", async () => {
    const artifacts = new FakeArtifactStore({ "k": textractBlocks(["Validade: 31/03/2027"]) });
    const featureFlags = new FakeFeatureFlagsReader(undefined, true);
    const output = await runDeterministicParser({ artifacts, featureFlags }, baseInput({ ocrAvailable: true, artifact: { bucket: "b", key: "k" } }));
    expect(output.aiExtractionEnabled).toBe(false);
  });

  it("throws DeterministicParserFailedError when the OCR artifact cannot be read", async () => {
    const artifacts = new FakeArtifactStore(); // no entry for the requested key
    const featureFlags = new FakeFeatureFlagsReader();
    await expect(
      runDeterministicParser({ artifacts, featureFlags }, baseInput({ ocrAvailable: true, artifact: { bucket: "b", key: "missing" } })),
    ).rejects.toBeInstanceOf(DeterministicParserFailedError);
  });

  it("throws DeterministicParserFailedError when the OCR artifact is not valid Textract block JSON", async () => {
    const artifacts = new FakeArtifactStore({ k: "not json{{{" });
    const featureFlags = new FakeFeatureFlagsReader();
    await expect(
      runDeterministicParser({ artifacts, featureFlags }, baseInput({ ocrAvailable: true, artifact: { bucket: "b", key: "k" } })),
    ).rejects.toBeInstanceOf(DeterministicParserFailedError);
  });

  it("treats ocrAvailable=true without an artifact ref as degraded (never crashes)", async () => {
    const artifacts = new FakeArtifactStore();
    const featureFlags = new FakeFeatureFlagsReader();
    const output = await runDeterministicParser({ artifacts, featureFlags }, baseInput({ ocrAvailable: true }));
    expect(output.ocrAvailable).toBe(false);
  });
});
