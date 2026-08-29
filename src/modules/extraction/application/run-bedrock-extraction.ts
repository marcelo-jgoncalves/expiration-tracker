/**
 * `BedrockExtractionTaskHandler`'s single operation (M7 item 6, D-035 §1.9/§1.11) - the ASL's
 * `RunBedrock` state (`arn:aws:states:::lambda:invoke`, plain synchronous invocation, same
 * shape as item 5's `RunDeterministicParser` - no task token). Reached only when
 * `RunDeterministicParser`'s output said `needsBedrock: true` AND `aiExtractionEnabled: true`
 * (the ASL's `NeedsBedrock`/`CheckAiKillSwitch` Choice states), but this function re-checks the
 * kill switch itself (defense in depth, never the only gate - the ASL Choice can be bypassed by
 * a hand-crafted `StartExecution` input in theory, so the paid call must never trust its own
 * caller blindly).
 *
 * Consumes exactly what item 5's `runDeterministicParser()` produces (`RunDeterministicParserOutput`)
 * - never reimplements `needsBedrock()`/`decide-bedrock.ts`'s contract, and never re-reads the
 * OCR artifact through a different path than the one `PdfParserTaskHandler` already resolved.
 */
import { AiExtractionDisabledError, BedrockExtractionFailedError, QuotaExceededError } from "../../../shared/errors/app-error.js";
import type { FeatureFlagsReader } from "../ports/feature-flags-reader.js";
import type { BedrockClient } from "../ports/bedrock-client.js";
import type { ExtractionArtifactRef } from "../ports/ocr-artifact-store.js";
import { TenantQuotaService } from "../../identity/application/quota.js";
import type { ExtractedFieldValueType } from "../domain/extracted-field.js";
import { BEDROCK_SYSTEM_PROMPT_VERSION } from "../domain/bedrock-extraction.js";

export interface RunBedrockExtractionDeps {
  featureFlags: FeatureFlagsReader;
  quota: TenantQuotaService;
  bedrock: BedrockClient;
  /** Bounded local retry before propagating `BedrockExtractionFailedError` - same discipline as
   * `start-ocr.ts`'s `jobPersistAttempts`, but here the "operation" being retried is the model
   * call itself, so this defaults low (a single retry) to avoid amplifying the cost-abuse
   * surface a flaky retry loop would create. */
  callAttempts?: number;
}

export interface RunBedrockExtractionFieldInput {
  fieldName: string;
  valueType: ExtractedFieldValueType;
  candidateValue?: string;
  confidence?: number;
  source: "DETERMINISTIC_PARSER";
}

/** Mirrors `RunDeterministicParserOutput` exactly - the ASL passes item 5's output straight
 * through as this handler's input (`Parameters.Payload.$: "$"` after the `RunDeterministicParser`
 * task's `OutputPath` strips the `lambda:invoke` wrapper - see `document-extraction.asl.json`). */
export interface RunBedrockExtractionInput {
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  /** The run's one business correlationId (ExtractionExecutionInput's doc comment) - echoed
   * back in RunBedrockExtractionOutput so ValidateSchema keeps receiving it. */
  correlationId: string;
  ocrAvailable: boolean;
  extractedFields: RunBedrockExtractionFieldInput[];
  needsBedrock: boolean;
  aiExtractionEnabled: boolean;
  artifact?: ExtractionArtifactRef;
}

export interface BedrockFieldCandidateOutput {
  fieldName: string;
  valueType: ExtractedFieldValueType;
  candidateValue?: string;
  confidence?: number;
  source: "BEDROCK";
}

/** Shaped for item 7 (`ExtractionValidationTaskHandler`'s `CompareExtractors`) to consume
 * alongside item 5's `extractedFields` (deterministic) - same discipline items 4/5 already
 * followed ("assemble what the next real consumer needs"). Deliberately does NOT merge/compare
 * against the deterministic candidates itself - `ExtractionAgreement` (MATCH/MISMATCH/
 * SINGLE_SOURCE) is item 7's job, this function only reports what Bedrock itself produced. */
export interface RunBedrockExtractionOutput {
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  correlationId: string;
  bedrockFields: BedrockFieldCandidateOutput[];
  bedrockSystemPromptVersion: string;
  // Passthrough of RunDeterministicParser's own output (item 7 finding, D-035 §2: the ASL's
  // RunBedrock -> ValidateSchema transition has no separate merge step, so whatever this
  // function returns IS $ for ValidateSchema - without echoing these back, item 5's
  // extractedFields/artifact/needsBedrock/aiExtractionEnabled would be silently lost on every
  // run that actually reaches Bedrock, the exact class of ResultPath bug item 5 already found
  // and fixed once for completeOcr's own success payload). Never recomputed - these are the
  // SAME values `input` already carried in, just carried back out.
  ocrAvailable: boolean;
  extractedFields: RunBedrockExtractionFieldInput[];
  needsBedrock: boolean;
  aiExtractionEnabled: boolean;
  artifact?: ExtractionArtifactRef;
}

const AI_CALL_RESERVATION_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export async function runBedrockExtraction(deps: RunBedrockExtractionDeps, input: RunBedrockExtractionInput): Promise<RunBedrockExtractionOutput> {
  let flags;
  try {
    flags = await deps.featureFlags.getFlags();
  } catch {
    // Fail-closed (mandatory, per feature-flags-reader.ts's own contract) - any read error is
    // treated identically to AI_EXTRACTION=false, never as "unknown, proceed".
    throw new AiExtractionDisabledError("Feature flags could not be read; failing closed.", { documentId: input.documentId, runId: input.runId });
  }
  if (!flags.AI_EXTRACTION) {
    throw new AiExtractionDisabledError("AI_EXTRACTION kill switch is off.", { documentId: input.documentId, runId: input.runId });
  }

  if (!input.artifact) {
    // No OCR text artifact was ever produced for this run (RunTextract failed, or OCR was
    // disabled) - there is nothing for Bedrock to read. This is not itself an error: the ASL
    // only reaches RunBedrock when needsBedrock was true, and needsBedrock's rule (a) treats
    // "no deterministic candidate" as needing Bedrock even with zero OCR text available, so a
    // caller CAN legitimately reach here with no artifact. Bedrock cannot help without any
    // document text either, so this returns zero candidates rather than calling the model with
    // an empty document (which would waste a paid call and a quota reservation for a
    // guaranteed-empty answer).
    return {
      tenantId: input.tenantId,
      itemId: input.itemId,
      documentId: input.documentId,
      documentVersion: input.documentVersion,
      runId: input.runId,
      pipelineVersion: input.pipelineVersion,
      correlationId: input.correlationId,
      bedrockFields: [],
      bedrockSystemPromptVersion: BEDROCK_SYSTEM_PROMPT_VERSION,
      ocrAvailable: input.ocrAvailable,
      extractedFields: input.extractedFields,
      needsBedrock: input.needsBedrock,
      aiExtractionEnabled: input.aiExtractionEnabled,
      artifact: input.artifact,
    };
  }

  // Idempotency key mirrors start-ocr.ts's exact pattern (design §1.11's 14th adversarial case
  // - cost-abuse via repeated reprocessing of an unchanged document): `runId` is itself
  // deterministic from tenantId|documentId|documentVersion|pipelineVersion
  // (deriveExtractionRunId(), extraction-run.ts), so a retried/duplicate Step Functions
  // execution for the SAME document version reserves against the SAME quota window and hits
  // QuotaExceededError on its own prior reservation - never a second paid Bedrock call for an
  // unchanged document.
  const quotaWindow = `${input.runId}|BEDROCK`;
  try {
    await deps.quota.consume({ tenantId: input.tenantId, quotaType: "AI_CALL", window: quotaWindow, limit: 1, windowSeconds: AI_CALL_RESERVATION_WINDOW_SECONDS });
  } catch (err) {
    if (!(err instanceof QuotaExceededError)) throw err;
    // Same run already reserved AI_CALL/BEDROCK on a prior attempt. Idempotent replay: since the
    // actual model call has not happened yet at this point in a genuinely fresh attempt, and a
    // reservation here can only pre-exist from an earlier attempt of the SAME run, we still
    // proceed to call Bedrock exactly once for this attempt - the guarantee this quota key
    // provides is "at most one concurrent/duplicate EXECUTION reserves this run's Bedrock call
    // slot", not a second layer of dedup on top of the ASL's own single-path execution. A
    // genuinely already-answered run never reaches RunBedrock again because CompleteRun (item 7)
    // is terminal.
  }

  const attempts = Math.max(1, deps.callAttempts ?? 1);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await deps.bedrock.extract({
        textArtifact: input.artifact,
        pipelineVersion: input.pipelineVersion,
        systemPromptVersion: BEDROCK_SYSTEM_PROMPT_VERSION,
      });

      const schemaByName = new Map(input.extractedFields.map((f) => [f.fieldName, f.valueType]));
      const bedrockFields: BedrockFieldCandidateOutput[] = result.fields.map((f) => ({
        fieldName: f.fieldName,
        valueType: schemaByName.get(f.fieldName) ?? "STRING",
        candidateValue: f.value === "" ? undefined : f.value,
        confidence: f.confidence,
        source: "BEDROCK",
      }));

      return {
        tenantId: input.tenantId,
        itemId: input.itemId,
        documentId: input.documentId,
        documentVersion: input.documentVersion,
        runId: input.runId,
        pipelineVersion: input.pipelineVersion,
        correlationId: input.correlationId,
        bedrockFields,
        bedrockSystemPromptVersion: BEDROCK_SYSTEM_PROMPT_VERSION,
        ocrAvailable: input.ocrAvailable,
        extractedFields: input.extractedFields,
        needsBedrock: input.needsBedrock,
        aiExtractionEnabled: input.aiExtractionEnabled,
        artifact: input.artifact,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  // The call never succeeded even after local retry - compensate the quota reservation (design
  // §1.8's exact compensation pattern from start-ocr.ts) before propagating, so a genuinely
  // failed call does not permanently burn this run's one Bedrock attempt.
  await deps.quota.release({ tenantId: input.tenantId, quotaType: "AI_CALL", window: quotaWindow, windowSeconds: AI_CALL_RESERVATION_WINDOW_SECONDS });
  throw new BedrockExtractionFailedError(`Bedrock extraction failed for run ${input.runId} after ${attempts} attempt(s).`, {
    runId: input.runId,
    documentId: input.documentId,
    cause: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
}
