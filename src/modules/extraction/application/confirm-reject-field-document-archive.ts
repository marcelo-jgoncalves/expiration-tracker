/**
 * confirmFieldForDocumentArchive / rejectFieldForDocumentArchive — D-193 item 4/9
 * (`estado-final-consolidado.md` "Transação de confirmação — cardinalidade fixa, Requirement
 * nunca dentro dela"): the `document-archive` counterpart of `confirm-reject-field.ts`'s OLD
 * `document`-module 4-way transaction. Confirm is 3 aggregates / 4 actions (`DocumentVersion`
 * Update, `ExtractionRun` ConditionCheck, `ExtractedField` Update, `Outbox` Put — the last one
 * only when `planDocumentVersionValidityEffect` says `validUntil` actually changed). Reject is
 * 2 aggregates / 2 actions (`ExtractedField` Update, `ExtractionRun` ConditionCheck) and never
 * touches `DocumentVersion` at all.
 *
 * `Requirement` never appears in either transaction — its convergence is fully asynchronous
 * (item 5/9, a separate slice not yet built): the conditional outbox row is only ever a
 * "wake up", never a value carrier.
 *
 * `planDocumentVersionValidityEffect` (`../domain/document-version-validity-effect.ts`) is the
 * ONE planner this file's `doConfirmFieldForDocumentArchive` shares with the pipeline's
 * auto-confirm path (`run-extraction-validation.ts`'s `persistExtractedFieldsStage`) — checklist
 * criterion 5: the two paths must reach the identical `DocumentVersion` effect by construction.
 *
 * No `ExpirationItem`/OLD-`Document` concept exists on this side (the sibling file's `itemId`
 * has no equivalent here) — `documentId`+`seq` locate the `DocumentVersion` row directly
 * (`document-archive/domain/document-version.ts#documentVersionKey`), exactly as
 * `start-extraction-run-for-document-archive.ts` and `run-extraction-validation.ts` already do
 * for this same pipeline.
 *
 * No HTTP route wires this yet — deferred (the `document-archive` review/confirm UI is a later
 * slice); this file establishes the mechanism whose shape D-193 item 4/9 fixes.
 */
import { createHash } from "node:crypto";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { IdempotencyStore } from "../../../shared/idempotency/idempotency.js";
import { documentVersionKey, type DocumentVersion } from "../../document-archive/domain/document-version.js";
import { extractionRunKey, type ExtractionRun } from "../domain/extraction-run.js";
import { extractedFieldKey, type ExtractedField } from "../domain/extracted-field.js";
import { getFieldSchema } from "../domain/field-schema.js";
import { isValidFieldValue } from "../domain/validate-field-value.js";
import { planDocumentVersionValidityEffect } from "../domain/document-version-validity-effect.js";
import type { EntityReader } from "../ports/entity-reader.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import type { ExtractedFieldStore } from "../ports/extracted-field-store.js";

/** Fixed sentinel for the pipeline's auto-confirm path's `confirmedBy` — never a fabricated
 * userId (`extracted-field.ts`'s own doc comment on the field). Exported so
 * `run-extraction-validation.ts` uses the exact same literal, never a re-typed copy. */
export const SYSTEM_AUTO_CONFIRM_ACTOR = "SYSTEM_AUTO_CONFIRM";

export interface ConfirmRejectFieldDocumentArchiveDeps {
  archive: EntityReader;
  runs: ExtractionRunStore;
  fields: ExtractedFieldStore;
  idempotency: IdempotencyStore;
  now: () => string;
}

export interface ConfirmFieldDocumentArchiveParams {
  documentId: string;
  seq: number;
  runId: string;
  fieldName: string;
  expectedDocumentVersionVersion: number;
  expectedRunVersion: number;
  expectedFieldVersion: number;
  confirmedValue: string;
  correlationId: string;
  idempotencyKey: string;
}

export interface RejectFieldDocumentArchiveParams {
  documentId: string;
  runId: string;
  fieldName: string;
  expectedRunVersion: number;
  expectedFieldVersion: number;
  correctionReason?: string;
  idempotencyKey: string;
}

async function readField(deps: ConfirmRejectFieldDocumentArchiveDeps, tenantId: string, documentId: string, fieldName: string, runId: string): Promise<ExtractedField> {
  const field = await deps.fields.get(extractedFieldKey(tenantId, documentId, fieldName, runId));
  if (!field || field.tenantId !== tenantId) {
    throw new NotFoundError("ExtractedField not found.", { documentId, fieldName, runId });
  }
  return field;
}

async function readRun(deps: ConfirmRejectFieldDocumentArchiveDeps, tenantId: string, documentId: string, runId: string) {
  const key = extractionRunKey(tenantId, documentId, runId);
  const run = await deps.runs.get<ExtractionRun>(key);
  if (!run || run.tenantId !== tenantId) throw new NotFoundError("ExtractionRun not found.", { documentId, runId });
  return { key, run };
}

async function readDocumentVersion(deps: ConfirmRejectFieldDocumentArchiveDeps, tenantId: string, documentId: string, seq: number) {
  const key = documentVersionKey(tenantId, documentId, seq);
  const version = await deps.archive.get<DocumentVersion>(key);
  if (!version || version.tenantId !== tenantId) throw new NotFoundError("DocumentVersion not found.", { documentId, seq });
  return { key, version };
}

function assertVersion(entity: string, expected: number, actual: number, details: Record<string, unknown>): void {
  if (expected !== actual) {
    throw new ConflictError(`${entity} version mismatch — expected ${expected}, current ${actual}.`, { ...details, expected, actual });
  }
}

export async function confirmFieldForDocumentArchive(
  deps: ConfirmRejectFieldDocumentArchiveDeps,
  ctx: RequestContext,
  params: ConfirmFieldDocumentArchiveParams,
): Promise<ExtractedField> {
  authorize({ context: ctx, action: "extraction:confirm", resource: { tenantId: ctx.tenant.tenantId } });

  const tenantId = ctx.tenant.tenantId;
  const operation = "extraction.confirmFieldForDocumentArchive";
  const key = params.idempotencyKey;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        documentId: params.documentId,
        seq: params.seq,
        runId: params.runId,
        fieldName: params.fieldName,
        expectedDocumentVersionVersion: params.expectedDocumentVersionVersion,
        expectedRunVersion: params.expectedRunVersion,
        expectedFieldVersion: params.expectedFieldVersion,
        confirmedValue: params.confirmedValue,
      }),
    )
    .digest("hex");
  const expiresAt = new Date(Date.parse(deps.now()) + 24 * 60 * 60 * 1000).toISOString();

  const result = await deps.idempotency.begin({ tenantId, operation, key, requestHash, expiresAt });
  if (result === "COMPLETED_SAME_REQUEST") {
    return readField(deps, tenantId, params.documentId, params.fieldName, params.runId);
  }

  try {
    const outcome = await doConfirmFieldForDocumentArchive(deps, tenantId, ctx.principal.userId, params);
    await deps.idempotency.complete({ tenantId, operation, key, responseRef: params.fieldName });
    return outcome;
  } catch (err) {
    await deps.idempotency.abort({ tenantId, operation, key });
    throw err;
  }
}

async function doConfirmFieldForDocumentArchive(
  deps: ConfirmRejectFieldDocumentArchiveDeps,
  tenantId: string,
  confirmedBy: string,
  params: ConfirmFieldDocumentArchiveParams,
): Promise<ExtractedField> {
  const field = await readField(deps, tenantId, params.documentId, params.fieldName, params.runId);
  const { key: runKey, run } = await readRun(deps, tenantId, params.documentId, params.runId);
  const { key: versionKey, version } = await readDocumentVersion(deps, tenantId, params.documentId, params.seq);

  assertVersion("ExtractedField", params.expectedFieldVersion, field.version, { fieldName: params.fieldName });
  assertVersion("ExtractionRun", params.expectedRunVersion, run.version, { runId: params.runId });
  assertVersion("DocumentVersion", params.expectedDocumentVersionVersion, version.version, { documentId: params.documentId, seq: params.seq });

  if (field.state !== "PENDING_CONFIRMATION") {
    throw new BusinessRuleError(`ExtractedField is not pending confirmation (state=${field.state}).`, { fieldName: params.fieldName, state: field.state });
  }

  const schema = getFieldSchema(field.pipelineVersion);
  const definition = schema.find((f) => f.fieldName === field.fieldName);
  if (!definition) {
    throw new BusinessRuleError("Field is not part of its pipeline's schema.", { fieldName: field.fieldName, pipelineVersion: field.pipelineVersion });
  }
  if (!isValidFieldValue(definition.valueType, params.confirmedValue)) {
    throw new BusinessRuleError("confirmedValue fails validation for the field's value type.", { fieldName: field.fieldName, valueType: definition.valueType });
  }

  const now = deps.now();

  // The ONE planner shared with the pipeline's auto-confirm path (`run-extraction-validation.ts`)
  // — both compute the identical DocumentVersion effect from identical inputs.
  const effect = planDocumentVersionValidityEffect({ fieldName: field.fieldName, confirmedValue: params.confirmedValue, documentVersion: version });

  const outcome = await deps.fields.confirmFieldForDocumentArchive({
    documentId: params.documentId,
    fieldKey: extractedFieldKey(tenantId, params.documentId, params.fieldName, params.runId),
    fieldTenantId: tenantId,
    fieldExpectedVersion: params.expectedFieldVersion,
    confirmedValue: params.confirmedValue,
    confirmedBy,
    runKey,
    runExpectedVersion: params.expectedRunVersion,
    documentVersionKey: versionKey,
    documentVersionTenantId: tenantId,
    documentVersionExpectedVersion: params.expectedDocumentVersionVersion,
    documentVersionVersionId: version.versionId,
    effect,
    tenantId,
    correlationId: params.correlationId,
    now,
  });

  if (outcome === "VERSION_CONFLICT") {
    throw new ConflictError("Version conflict while confirming field — one of run/documentVersion/field changed concurrently.", {
      documentId: params.documentId,
      runId: params.runId,
      fieldName: params.fieldName,
    });
  }

  return { ...field, state: "CONFIRMED", confirmedValue: params.confirmedValue, confirmedBy, confirmedAt: now, version: field.version + 1, updatedAt: now };
}

export async function rejectFieldForDocumentArchive(
  deps: ConfirmRejectFieldDocumentArchiveDeps,
  ctx: RequestContext,
  params: RejectFieldDocumentArchiveParams,
): Promise<ExtractedField> {
  authorize({ context: ctx, action: "extraction:confirm", resource: { tenantId: ctx.tenant.tenantId } });

  const tenantId = ctx.tenant.tenantId;
  const operation = "extraction.rejectFieldForDocumentArchive";
  const key = params.idempotencyKey;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        documentId: params.documentId,
        runId: params.runId,
        fieldName: params.fieldName,
        expectedRunVersion: params.expectedRunVersion,
        expectedFieldVersion: params.expectedFieldVersion,
        correctionReason: params.correctionReason ?? null,
      }),
    )
    .digest("hex");
  const expiresAt = new Date(Date.parse(deps.now()) + 24 * 60 * 60 * 1000).toISOString();

  const result = await deps.idempotency.begin({ tenantId, operation, key, requestHash, expiresAt });
  if (result === "COMPLETED_SAME_REQUEST") {
    return readField(deps, tenantId, params.documentId, params.fieldName, params.runId);
  }

  try {
    const outcome = await doRejectFieldForDocumentArchive(deps, tenantId, params);
    await deps.idempotency.complete({ tenantId, operation, key, responseRef: params.fieldName });
    return outcome;
  } catch (err) {
    await deps.idempotency.abort({ tenantId, operation, key });
    throw err;
  }
}

async function doRejectFieldForDocumentArchive(
  deps: ConfirmRejectFieldDocumentArchiveDeps,
  tenantId: string,
  params: RejectFieldDocumentArchiveParams,
): Promise<ExtractedField> {
  const field = await readField(deps, tenantId, params.documentId, params.fieldName, params.runId);
  const { key: runKey, run } = await readRun(deps, tenantId, params.documentId, params.runId);

  assertVersion("ExtractedField", params.expectedFieldVersion, field.version, { fieldName: params.fieldName });
  assertVersion("ExtractionRun", params.expectedRunVersion, run.version, { runId: params.runId });

  if (field.state !== "PENDING_CONFIRMATION") {
    throw new BusinessRuleError(`ExtractedField is not pending confirmation (state=${field.state}).`, { fieldName: params.fieldName, state: field.state });
  }

  const now = deps.now();
  // 2 aggregates / 2 actions — DocumentVersion is never referenced, not even a ConditionCheck.
  const outcome = await deps.fields.rejectFieldForDocumentArchive({
    fieldKey: extractedFieldKey(tenantId, params.documentId, params.fieldName, params.runId),
    fieldTenantId: tenantId,
    fieldExpectedVersion: params.expectedFieldVersion,
    correctionReason: params.correctionReason,
    runKey,
    runExpectedVersion: params.expectedRunVersion,
    now,
  });

  if (outcome === "VERSION_CONFLICT") {
    throw new ConflictError("Version conflict while rejecting field — run or field changed concurrently.", {
      documentId: params.documentId,
      runId: params.runId,
      fieldName: params.fieldName,
    });
  }

  const result: ExtractedField = { ...field, state: "REJECTED", version: field.version + 1, updatedAt: now };
  if (params.correctionReason !== undefined) result.correctionReason = params.correctionReason;
  return result;
}
