/**
 * `PdfParserTaskHandler`'s single operation (M7 item 5, D-035 §1.3) - the ASL's
 * `RunDeterministicParser` state (`arn:aws:states:::lambda:invoke`, plain synchronous
 * invocation, NOT `waitForTaskToken` - there is no task token in this state at all, unlike
 * `RunTextract`). Runs entirely deterministic, non-AI logic: read the OCR artifact (if any),
 * scan it for `expirationDate` candidates, decide whether Bedrock is needed
 * (`decide-bedrock.ts`'s `needsBedrock()`), and read the `AI_EXTRACTION` kill switch so the
 * next ASL state (`CheckAiKillSwitch`) doesn't need its own AppConfig read.
 *
 * Reached from the ASL in TWO distinct shapes (design §1.2, "RunTextract failure above...
 * still reaches this state and must run degraded"):
 *  - happy path: `$` is `completeOcr`'s `SendTaskSuccess` payload (`ocrAvailable: true`,
 *    `artifact`, plus the run identity fields it re-attaches - see complete-ocr.ts).
 *  - degraded path: `$` is the ORIGINAL execution input (untouched by the Catch's
 *    `ResultPath: "$.ocrFailure"`) - `ocrAvailable` is absent/false, no `artifact`.
 *
 * DECISÃO PENDENTE (recorded here and in NEXT_SESSION_PROMPT.md, conservative default): the
 * design's "parser tries file-metadata-only heuristics" for the degraded path is not
 * implemented - no PDF/file metadata field (creation date, etc.) semantically corresponds to
 * `expirationDate`, so fabricating a heuristic mapping here would be an unreviewed product
 * decision, not an engineering default. Degraded mode returns zero candidates for the
 * required field, which `needsBedrock()` rule (a) already treats correctly (no candidate =
 * needs Bedrock, or PENDING_CONFIRMATION if Bedrock is off/unavailable) - never fabricates a
 * value. Revisit only if a future field-schema entry actually maps to real PDF metadata.
 */
import { extractExpirationDateCandidates } from "../domain/deterministic-field-parser.js";
import { needsBedrock, type BedrockDecisionInput, type FieldExtractionAssessment } from "../domain/decide-bedrock.js";
import { getFieldSchema, THRESHOLD_VERSION_V1 } from "../domain/field-schema.js";
import type { ExtractedFieldValueType } from "../domain/extracted-field.js";
import { DeterministicParserFailedError } from "../../../shared/errors/app-error.js";
import type { OcrArtifactStore, ExtractionArtifactRef } from "../ports/ocr-artifact-store.js";
import type { FeatureFlagsReader } from "../ports/feature-flags-reader.js";

export interface RunDeterministicParserDeps {
  artifacts: OcrArtifactStore;
  featureFlags: FeatureFlagsReader;
}

export interface RunDeterministicParserInput {
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  /** The run's one business correlationId (ExtractionExecutionInput's doc comment) - echoed
   * back in RunDeterministicParserOutput so RunBedrock/ValidateSchema keep receiving it. */
  correlationId: string;
  /** Present (`true`) only on the happy path (`RunTextract` succeeded). Absent/false on the
   * degraded path (`RunTextract` failed - `$.ocrFailure` carries the Catch details, not
   * consumed here). */
  ocrAvailable?: boolean;
  artifact?: ExtractionArtifactRef;
}

export interface DeterministicFieldCandidateOutput {
  fieldName: string;
  valueType: ExtractedFieldValueType;
  candidateValue?: string;
  confidence?: number;
  source: "DETERMINISTIC_PARSER";
}

export interface RunDeterministicParserOutput {
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  correlationId: string;
  ocrAvailable: boolean;
  extractedFields: DeterministicFieldCandidateOutput[];
  needsBedrock: boolean;
  aiExtractionEnabled: boolean;
  /** Re-attached only when `ocrAvailable` - the SAME artifact ref `BedrockExtractionTaskHandler`
   * (item 6) reads via `OcrArtifactStore.get()` when `needsBedrock`/`aiExtractionEnabled` route
   * the ASL to `RunBedrock`. Never a second Textract read - this is the identical S3 object
   * `completeOcr` (item 4) wrote. */
  artifact?: ExtractionArtifactRef;
}

interface TextractLineBlock {
  BlockType?: string;
  Text?: string;
}

function extractOcrText(blocksJson: string): string {
  let blocks: unknown;
  try {
    blocks = JSON.parse(blocksJson);
  } catch (err) {
    throw new DeterministicParserFailedError("OCR artifact is not valid JSON.", { cause: err instanceof Error ? err.message : String(err) });
  }
  if (!Array.isArray(blocks)) {
    throw new DeterministicParserFailedError("OCR artifact JSON is not an array of Textract blocks.");
  }
  return (blocks as TextractLineBlock[])
    .filter((b) => b.BlockType === "LINE" && typeof b.Text === "string")
    .map((b) => b.Text as string)
    .join("\n");
}

export async function runDeterministicParser(deps: RunDeterministicParserDeps, input: RunDeterministicParserInput): Promise<RunDeterministicParserOutput> {
  const ocrAvailable = input.ocrAvailable === true && input.artifact !== undefined;

  let ocrText = "";
  if (ocrAvailable) {
    let blocksJson: string;
    try {
      blocksJson = await deps.artifacts.get(input.artifact!);
    } catch (err) {
      throw new DeterministicParserFailedError("Failed to read OCR artifact.", { runId: input.runId, cause: err instanceof Error ? err.message : String(err) });
    }
    ocrText = extractOcrText(blocksJson);
  }

  const schema = getFieldSchema(input.pipelineVersion);
  const extractedFields: DeterministicFieldCandidateOutput[] = [];
  const assessments: FieldExtractionAssessment[] = [];

  for (const field of schema) {
    // v1 only defines `expirationDate` (field-schema.ts) - every field is a DATE field today,
    // so the same regex-based parser handles all of them. A future non-date field would need
    // a dispatch here; deliberately not built ahead of that need.
    const { candidates, best } = ocrText ? extractExpirationDateCandidates(ocrText) : { candidates: [], best: undefined };

    assessments.push({
      fieldName: field.fieldName,
      required: field.required,
      deterministicCandidate: best,
      ocrCandidates: candidates,
    });

    extractedFields.push({
      fieldName: field.fieldName,
      valueType: field.valueType,
      candidateValue: best?.value,
      confidence: best?.confidence,
      source: "DETERMINISTIC_PARSER",
    });
  }

  const decisionInput: BedrockDecisionInput = { fields: assessments, ocrAvailable, thresholdVersion: THRESHOLD_VERSION_V1 };
  const bedrockNeeded = needsBedrock(decisionInput);

  let aiExtractionEnabled = false;
  try {
    const flags = await deps.featureFlags.getFlags();
    aiExtractionEnabled = flags.AI_EXTRACTION;
  } catch {
    // Fail-closed (same contract as OCR's kill switch, feature-flags-reader.js) - any read
    // error is treated as AI_EXTRACTION=false, never as "unknown, proceed".
    aiExtractionEnabled = false;
  }

  return {
    tenantId: input.tenantId,
    itemId: input.itemId,
    documentId: input.documentId,
    documentVersion: input.documentVersion,
    runId: input.runId,
    pipelineVersion: input.pipelineVersion,
    correlationId: input.correlationId,
    ocrAvailable,
    extractedFields,
    needsBedrock: bedrockNeeded,
    aiExtractionEnabled,
    artifact: ocrAvailable ? input.artifact : undefined,
  };
}
