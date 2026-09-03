/**
 * `ExtractionValidationTaskHandler`'s five operations (M7 item 7, D-035 §2/§3) — the ASL's
 * `ValidateSchema`/`CompareExtractors`/`PersistExtractedFields`/`MarkPendingConfirmation`/
 * `CompleteRun` states, all invoking this one Lambda (`extraction-validation-task:live`) with a
 * distinct `operation` per state (kept as separate Task states for per-stage `Catch`/audit,
 * design §2's closing paragraph — never collapsed into one call).
 *
 * Context threading: each state's ASL `Parameters.Payload` is `{ operation, input.$: "$" }`,
 * and `ResultSelector`/`OutputPath` unwrap the handler's real return value back onto `$` (same
 * pattern item 5/6 already established for `RunDeterministicParser`) — so each operation here
 * receives the FULL accumulated execution context and returns it augmented with whatever this
 * stage adds, which becomes `$` for the next state directly.
 *
 * The single most load-bearing invariant in this file (design §3, the design's own "most
 * serious finding"): the transient OCR artifact is deleted ONLY by `completeRun()` and
 * `markPendingConfirmation()` — never by `validateSchema()`/`compareExtractorsStage()`/
 * `persistExtractedFieldsStage()`. Those three run BEFORE the run has reached any terminal
 * state (a retry of any of them must still be able to re-read the artifact), so none of them
 * may touch `OcrArtifactStore.delete()` under any circumstance.
 */
import { getFieldSchema } from "../domain/field-schema.js";
import { isValidFieldValue } from "../domain/validate-field-value.js";
import { compareExtractors, type SourceCandidate, type ComparisonResult } from "../domain/compare-extractors.js";
import { decideFieldOutcome } from "../domain/decide-field-outcome.js";
import { extractionRunKey } from "../domain/extraction-run.js";
import { extractedFieldKey, type ExtractedField, type ExtractedFieldValueType, type ExtractionSource } from "../domain/extracted-field.js";
import { documentKey, type Document } from "../../document/domain/document.js";
// D-193 item 3/9 slice 3: the `document-archive` counterpart of the OLD `document`-module
// `Document` above — aliased to avoid a name collision, never the same entity. Both are read
// through the same generic `DocumentReader.get()` (structural, single-table reuse), never a
// second port.
import { documentKey as documentArchiveKey, type Document as ArchiveDocument } from "../../document-archive/domain/document.js";
import { itemKey, type ExpirationItem } from "../../expiration/domain/expiration-item.js";
import { buildItemAttributeUpdate, ITEM_ATTRIBUTE_BY_FIELD_NAME } from "./item-field-mapping.js";
import type { DocumentReader } from "../ports/document-reader.js";
import type { EntityReader } from "../ports/entity-reader.js";
import type { CommitItemUpdate } from "../ports/extracted-field-store.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import type { ExtractedFieldStore } from "../ports/extracted-field-store.js";
import type { ExtractionArtifactRef, OcrArtifactStore } from "../ports/ocr-artifact-store.js";
import { ExtractionCommitFailedError } from "../../../shared/errors/app-error.js";

export interface RunExtractionValidationDeps {
  documents: DocumentReader;
  /** Read-only access to the `ExpirationItem` — needed ONLY by `PERSIST_EXTRACTED_FIELDS`, to
   * read the version/status the auto-confirm `dueDate` update must be OCC-guarded against
   * (W2-01-DECISION). No write capability: the write itself goes through
   * `ExtractedFieldStore.commitRunOutcome`'s single transaction. */
  items: EntityReader;
  runs: ExtractionRunStore;
  fields: ExtractedFieldStore;
  artifacts: OcrArtifactStore;
  now?: () => string;
}

/** One entry per extractor for one field - the shape `run-deterministic-parser.ts`/
 * `run-bedrock-extraction.ts` already produce, threaded through unchanged. */
export interface ValidationFieldCandidate {
  fieldName: string;
  valueType: ExtractedFieldValueType;
  candidateValue?: string;
  confidence?: number;
  source: ExtractionSource;
  /** Added by `validateSchema()` - absent on the way in. */
  valid?: boolean;
}

/** The full execution context threaded through all five operations. Deliberately permissive
 * (`Record<string, unknown>`-free but every extra ASL passthrough field like `ocrFailure`/
 * `parserFailure`/`bedrockFailure` is optional and never read here) - this handler never needs
 * to interpret a Catch's captured error details, only preserve them across the JSON round-trip. */
export interface ValidationContext {
  tenantId: string;
  /** D-193 item 3/9 slice 3 (`ExtractionExecutionInput`'s own doc comment has the full
   * rationale): dispatches `commitOrDiscard()` between the OLD `document`-module guard and the
   * `document-archive` guard. Optional/`undefined` treated as `"DOCUMENT"` — every execution
   * started before this slice (OLD trigger, or an in-flight Standard execution from before this
   * deploy) never set this field, and must keep resolving to the OLD path unchanged. */
  documentSource?: "DOCUMENT" | "DOCUMENT_ARCHIVE";
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  /** The run's one business correlationId (ExtractionExecutionInput's doc comment). Would
   * survive the round-trip anyway via this interface's `[passthrough: string]: unknown` index
   * signature, but named explicitly here (like every other identity field above) rather than
   * relying on that signature - consistent with how this codebase treats passthrough fields
   * elsewhere, and greppable for anyone tracing correlationId through this pipeline. */
  correlationId: string;
  ocrAvailable?: boolean;
  extractedFields?: ValidationFieldCandidate[];
  bedrockFields?: ValidationFieldCandidate[];
  needsBedrock?: boolean;
  aiExtractionEnabled?: boolean;
  artifact?: ExtractionArtifactRef;
  comparedFields?: Array<{
    fieldName: string;
    valueType: ExtractedFieldValueType;
    agreement: ComparisonResult["agreement"];
    sources: readonly ExtractionSource[];
    candidateValue?: string;
    confidence?: number;
  }>;
  runOutcome?: "COMPLETED" | "FAILED" | "DISCARDED";
  requiresReview?: boolean;
  [passthrough: string]: unknown;
}

// ---------------------------------------------------------------------------------------------
// VALIDATE_SCHEMA
// ---------------------------------------------------------------------------------------------

export function validateSchema(input: ValidationContext): ValidationContext {
  const mark = (c: ValidationFieldCandidate): ValidationFieldCandidate => ({
    ...c,
    valid: c.candidateValue === undefined ? false : isValidFieldValue(c.valueType, c.candidateValue),
  });

  return {
    ...input,
    extractedFields: (input.extractedFields ?? []).map(mark),
    bedrockFields: input.bedrockFields ? input.bedrockFields.map(mark) : input.bedrockFields,
  };
}

// ---------------------------------------------------------------------------------------------
// COMPARE_EXTRACTORS
// ---------------------------------------------------------------------------------------------

export function compareExtractorsStage(input: ValidationContext): ValidationContext {
  const schema = getFieldSchema(input.pipelineVersion);
  const deterministicByName = new Map((input.extractedFields ?? []).map((f) => [f.fieldName, f]));
  const bedrockByName = new Map((input.bedrockFields ?? []).map((f) => [f.fieldName, f]));

  const comparedFields = schema.map((field) => {
    const candidates: SourceCandidate[] = [];
    const det = deterministicByName.get(field.fieldName);
    if (det) candidates.push({ source: det.source, value: det.candidateValue, confidence: det.confidence, valid: det.valid ?? false });
    const brk = bedrockByName.get(field.fieldName);
    if (brk) candidates.push({ source: brk.source, value: brk.candidateValue, confidence: brk.confidence, valid: brk.valid ?? false });

    const result = compareExtractors(candidates);
    return {
      fieldName: field.fieldName,
      valueType: field.valueType,
      agreement: result.agreement,
      sources: result.sources,
      candidateValue: result.candidateValue,
      confidence: result.confidence,
    };
  });

  return { ...input, comparedFields };
}

// ---------------------------------------------------------------------------------------------
// Shared commit-or-discard helper (used by PERSIST_EXTRACTED_FIELDS and
// MARK_PENDING_CONFIRMATION - both write ExtractedField rows + transition the run atomically,
// guarded by the same Document-not-concurrently-changed check).
// ---------------------------------------------------------------------------------------------

async function commitOrDiscard(
  deps: RunExtractionValidationDeps,
  ctx: ValidationContext,
  fields: ExtractedField[],
  runStatus: "COMPLETED" | "FAILED",
  itemUpdate?: CommitItemUpdate,
): Promise<"COMPLETED" | "FAILED" | "DISCARDED"> {
  const now = deps.now?.() ?? new Date().toISOString();
  const runKey = extractionRunKey(ctx.tenantId, ctx.documentId, ctx.runId);
  // `ExtractionRun` is only ever created once (start-extraction-run.ts's putIfAbsent, version 1)
  // and never updated by anything else before this handler runs - documented invariant, not
  // read back here to avoid an extra consistent GetItem for a value that cannot have changed.
  const runExpectedVersion = 1;

  // D-193 item 3/9 slice 3: `documentSource` picks which aggregate is the TOCTOU-fence guard —
  // the OLD `document`-module `Document` (by `itemId`) or the `document-archive` `Document` (by
  // `documentId` alone, no `itemId` concept). `undefined` (any execution started before this
  // slice) resolves to the OLD path, unchanged.
  const docKey = ctx.documentSource === "DOCUMENT_ARCHIVE" ? documentArchiveKey(ctx.tenantId, ctx.documentId) : documentKey(ctx.tenantId, ctx.itemId, ctx.documentId);

  // D-193 item 3/9 slice 3: unlike the OLD path's `status === "DELETED"` (a genuine hard-delete
  // taxonomy value), `document-archive`'s `Document.status` only ever flips ACTIVE/ARCHIVED
  // (`document-archive/domain/document.ts`'s own doc comment: "archiving a Document can never
  // silently change" anything it satisfies) — ARCHIVED is a soft-hide, not "this document is
  // gone", so it is deliberately NOT treated as a discard reason here. Only a missing row (the
  // Document was deleted by a mechanism this codebase doesn't otherwise have) discards.
  const doc = await deps.documents.get<Document | ArchiveDocument>(docKey, true);
  const discardReason = ctx.documentSource === "DOCUMENT_ARCHIVE" ? !doc : !doc || (doc as Document).status === "DELETED";
  if (discardReason) {
    await deps.runs.updateStatus(runKey, ctx.tenantId, runExpectedVersion, "DISCARDED", now);
    return "DISCARDED";
  }

  let result: "COMMITTED" | "DOCUMENT_DISCARDED";
  try {
    result = await deps.fields.commitRunOutcome({
      fields,
      runKey,
      runTenantId: ctx.tenantId,
      runExpectedVersion,
      runStatus,
      completedAt: now,
      documentKey: docKey,
      documentExpectedVersion: doc!.version,
      ...(itemUpdate ? { itemUpdate } : {}),
    });
  } catch (err) {
    throw new ExtractionCommitFailedError(`Failed to commit outcome for run ${ctx.runId}.`, { runId: ctx.runId, documentId: ctx.documentId }, err);
  }

  if (result === "DOCUMENT_DISCARDED") {
    await deps.runs.updateStatus(runKey, ctx.tenantId, runExpectedVersion, "DISCARDED", now);
    return "DISCARDED";
  }
  return runStatus;
}

// ---------------------------------------------------------------------------------------------
// PERSIST_EXTRACTED_FIELDS
// ---------------------------------------------------------------------------------------------

/**
 * W2-01-DECISION (Marcelo, product owner): when the pipeline auto-confirms a field — high
 * confidence, no source disagreement, no human review needed — it must reach the SAME outcome
 * as a human clicking confirm, which includes writing `ExpirationItem.dueDate`. Before this,
 * the pipeline's most successful path persisted an `ExtractedField` in `CONFIRMED` state that
 * no route could ever apply to the item (the HTTP confirm route requires
 * `PENDING_CONFIRMATION` and answers 422 for an already-`CONFIRMED` field).
 *
 * Returns the `ExpirationItem` leg for `commitRunOutcome`'s transaction, or `undefined` when
 * there is nothing to write. Deliberate non-goals:
 *  - only auto-`CONFIRMED` fields count; `PENDING_CONFIRMATION` still waits for a human;
 *  - only fields the schema actually maps to an item attribute (`expirationDate` -> `dueDate`)
 *    — no invented handling for hypothetical future fields;
 *  - a missing or `DELETED` item is NOT an error here: the run still commits its fields (same
 *    tolerance the `Document` guard already has), it simply writes no item attribute.
 *
 * Idempotency/retry: this adds no new retry surface. The item `Update` rides inside the same
 * all-or-nothing `TransactWriteItems` as the field rows, whose per-row `attribute_not_exists`
 * guard already makes a re-run of an ALREADY-committed `PERSIST_EXTRACTED_FIELDS` cancel the
 * whole transaction (reported as `DOCUMENT_DISCARDED`). So a Lambda retry/redrive can never
 * apply the `dueDate` write twice, and a retry of a transaction that genuinely never committed
 * re-reads the item's current version here before trying again.
 */
async function buildAutoConfirmItemUpdate(
  deps: RunExtractionValidationDeps,
  ctx: ValidationContext,
  fields: readonly ExtractedField[],
): Promise<CommitItemUpdate | undefined> {
  const autoConfirmed = fields.filter((f) => f.state === "CONFIRMED" && f.confirmedValue !== undefined && ITEM_ATTRIBUTE_BY_FIELD_NAME[f.fieldName] !== undefined);
  if (autoConfirmed.length === 0) return undefined;

  const key = itemKey(ctx.tenantId, ctx.itemId);
  const item = await deps.items.get<ExpirationItem>(key, true);
  if (!item || item.tenantId !== ctx.tenantId || item.status === "DELETED") return undefined;

  const set: Record<string, unknown> = {};
  for (const field of autoConfirmed) {
    const attributeUpdate = buildItemAttributeUpdate({
      tenantId: ctx.tenantId,
      itemId: ctx.itemId,
      itemStatus: item.status,
      fieldName: field.fieldName,
      // Narrowed by the `filter` above; `noUncheckedIndexedAccess`-safe fallback for the
      // type-level `string | undefined` that the filter can't express.
      confirmedValue: field.confirmedValue ?? "",
    });
    Object.assign(set, attributeUpdate);
  }

  if (Object.keys(set).length === 0) return undefined;
  return { key, tenantId: ctx.tenantId, expectedVersion: item.version, set };
}

export async function persistExtractedFieldsStage(deps: RunExtractionValidationDeps, input: ValidationContext): Promise<ValidationContext> {
  const now = deps.now?.() ?? new Date().toISOString();
  const compared = input.comparedFields ?? [];

  const fields: ExtractedField[] = compared.map((cf) => {
    const outcome = decideFieldOutcome({ agreement: cf.agreement, sources: cf.sources, candidateValue: cf.candidateValue, confidence: cf.confidence });
    return {
      ...extractedFieldKey(input.tenantId, input.documentId, cf.fieldName, input.runId),
      entityType: "ExtractedField",
      tenantId: input.tenantId,
      documentId: input.documentId,
      runId: input.runId,
      fieldName: cf.fieldName,
      valueType: cf.valueType,
      candidateValue: cf.candidateValue,
      confidence: cf.confidence,
      sources: cf.sources,
      agreement: cf.agreement,
      state: outcome.state,
      confirmedValue: outcome.confirmedValue,
      documentVersion: input.documentVersion,
      pipelineVersion: input.pipelineVersion,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  });

  // D-193 item 3/9 slice 3: the auto-confirm `ExpirationItem.dueDate` write (W2-01-DECISION)
  // stays OLD-path-only in this slice — the `document-archive` equivalent effect
  // (`DocumentVersion.validUntil` via a shared `planDocumentVersionValidityEffect`) is item 4/9
  // of the approved design, explicitly out of scope here (`estado-final-consolidado.md`).
  const itemUpdate = input.documentSource === "DOCUMENT_ARCHIVE" ? undefined : await buildAutoConfirmItemUpdate(deps, input, fields);

  // NEVER deletes the artifact here - PersistExtractedFields runs before the run has reached a
  // terminal state (CompleteRun is the very next state); a retry of this state must still be
  // able to observe the same Document row it read a moment ago, and CompleteRun still needs
  // `input.artifact` intact to know what to delete (design §3).
  const outcome = await commitOrDiscard(deps, input, fields, "COMPLETED", itemUpdate);
  const requiresReview = outcome === "COMPLETED" && fields.some((f) => f.state === "PENDING_CONFIRMATION");

  return { ...input, runOutcome: outcome, requiresReview };
}

// ---------------------------------------------------------------------------------------------
// MARK_PENDING_CONFIRMATION - reached ONLY from RunDeterministicParser's own hard failure (the
// ASL's `parserFailure` Catch, design §1.2's "a única falha que vai direto para
// MarkPendingConfirmation") - no ValidateSchema/CompareExtractors/PersistExtractedFields ever
// ran for this execution, so this operation does both the DB commit AND the artifact deletion
// itself (design §3 names this state explicitly as one of the deletion points, "em caminho
// FAILED").
// ---------------------------------------------------------------------------------------------

export async function markPendingConfirmationStage(deps: RunExtractionValidationDeps, input: ValidationContext): Promise<ValidationContext> {
  const now = deps.now?.() ?? new Date().toISOString();
  const schema = getFieldSchema(input.pipelineVersion);

  const fields: ExtractedField[] = schema.map((field) => ({
    ...extractedFieldKey(input.tenantId, input.documentId, field.fieldName, input.runId),
    entityType: "ExtractedField",
    tenantId: input.tenantId,
    documentId: input.documentId,
    runId: input.runId,
    fieldName: field.fieldName,
    valueType: field.valueType,
    sources: [],
    agreement: "SINGLE_SOURCE",
    state: "PENDING_CONFIRMATION",
    documentVersion: input.documentVersion,
    pipelineVersion: input.pipelineVersion,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }));

  const outcome = await commitOrDiscard(deps, input, fields, "FAILED");

  // This branch reached the end of the line for this run - whatever OCR artifact exists (it may
  // never have been created at all, if RunTextract itself failed before the parser even ran) is
  // deleted now, unconditionally of `outcome` (FAILED or DISCARDED are both genuinely terminal).
  if (input.artifact) {
    await deps.artifacts.delete(input.artifact);
  }

  return { ...input, runOutcome: outcome, requiresReview: outcome === "FAILED" };
}

// ---------------------------------------------------------------------------------------------
// COMPLETE_RUN - the normal-path terminal state, reached only after PersistExtractedFields
// already committed the DB outcome (COMPLETED or, on a concurrent-discard race, DISCARDED).
// This operation's own job is ONLY the artifact deletion (design §3: "o único ponto do sistema
// que sabe com certeza que nenhum estado subsequente vai mais ler o artefato" - true here
// because CompleteRun has no `Next`, it's the ASL's terminal state on this path).
// ---------------------------------------------------------------------------------------------

export async function completeRunStage(deps: RunExtractionValidationDeps, input: ValidationContext): Promise<ValidationContext> {
  if (input.artifact) {
    await deps.artifacts.delete(input.artifact);
  }
  return { ...input };
}

export type ExtractionValidationOperation = "VALIDATE_SCHEMA" | "COMPARE_EXTRACTORS" | "PERSIST_EXTRACTED_FIELDS" | "MARK_PENDING_CONFIRMATION" | "COMPLETE_RUN";

export async function runExtractionValidation(deps: RunExtractionValidationDeps, operation: ExtractionValidationOperation, input: ValidationContext): Promise<ValidationContext> {
  switch (operation) {
    case "VALIDATE_SCHEMA":
      return validateSchema(input);
    case "COMPARE_EXTRACTORS":
      return compareExtractorsStage(input);
    case "PERSIST_EXTRACTED_FIELDS":
      return persistExtractedFieldsStage(deps, input);
    case "MARK_PENDING_CONFIRMATION":
      return markPendingConfirmationStage(deps, input);
    case "COMPLETE_RUN":
      return completeRunStage(deps, input);
  }
}
