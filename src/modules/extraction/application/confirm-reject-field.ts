/**
 * M7 item 8 (`claude-reconciliation-final-design.md` §1.7): the two HTTP confirmation routes —
 * `POST .../fields/{fieldName}/confirm` and `POST .../fields/{fieldName}/reject`. Same shape as
 * `ExpirationService.renewItem` (idempotent via `IdempotencyStore`, transactional via
 * `TransactWriteItems`) — `confirm` is a 4-way OCC (`ExpirationItem`/`Document`/`ExtractionRun`/
 * `ExtractedField`), `reject` is 3-way (never touches `ExpirationItem`).
 *
 * The `extraction:confirm` authorization action covers BOTH routes (§1.7: "the confirm/reject
 * distinction is an HTTP route distinction, not a separate authorization action").
 */
import { createHash } from "node:crypto";
import { BusinessRuleError, ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import { authorize } from "../../identity/domain/authorization.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { IdempotencyStore } from "../../../shared/idempotency/idempotency.js";
import { documentKey, type Document } from "../../document/domain/document.js";
import { itemKey, gsi1Keys, type ExpirationItem } from "../../expiration/domain/expiration-item.js";
import { extractionRunKey, type ExtractionRun } from "../domain/extraction-run.js";
import { extractedFieldKey, type ExtractedField } from "../domain/extracted-field.js";
import { getFieldSchema } from "../domain/field-schema.js";
import { isValidFieldValue } from "../domain/validate-field-value.js";
import type { EntityReader } from "../ports/entity-reader.js";
import type { ExtractionRunStore } from "../ports/extraction-run-store.js";
import type { ExtractedFieldStore } from "../ports/extracted-field-store.js";

/** Schema v1 only names `expirationDate` concretely (field-schema.ts) — the only field this
 * map needs today. A future field added to the pipeline schema that has no corresponding
 * `ExpirationItem` attribute yet simply isn't in this map, and `confirmField` below falls back
 * to a version-only `ConditionCheck` on the item rather than inventing a mapping. */
const ITEM_ATTRIBUTE_BY_FIELD_NAME: Record<string, string> = {
  expirationDate: "dueDate",
};

export interface ConfirmRejectFieldDeps {
  documents: EntityReader;
  items: EntityReader;
  runs: ExtractionRunStore;
  fields: ExtractedFieldStore;
  idempotency: IdempotencyStore;
  now: () => string;
}

export interface ConfirmFieldParams {
  itemId: string;
  documentId: string;
  runId: string;
  fieldName: string;
  expectedItemVersion: number;
  expectedDocumentVersion: number;
  expectedRunVersion: number;
  expectedFieldVersion: number;
  confirmedValue: string;
  idempotencyKey: string;
}

export interface RejectFieldParams {
  itemId: string;
  documentId: string;
  runId: string;
  fieldName: string;
  expectedDocumentVersion: number;
  expectedRunVersion: number;
  expectedFieldVersion: number;
  correctionReason?: string;
  idempotencyKey: string;
}

async function readField(deps: ConfirmRejectFieldDeps, tenantId: string, documentId: string, fieldName: string, runId: string): Promise<ExtractedField> {
  const field = await deps.fields.get(extractedFieldKey(tenantId, documentId, fieldName, runId));
  if (!field || field.tenantId !== tenantId) {
    throw new NotFoundError("ExtractedField not found.", { documentId, fieldName, runId });
  }
  return field;
}

async function readRun(deps: ConfirmRejectFieldDeps, tenantId: string, documentId: string, runId: string) {
  const key = extractionRunKey(tenantId, documentId, runId);
  const run = await deps.runs.get<ExtractionRun>(key);
  if (!run || run.tenantId !== tenantId) throw new NotFoundError("ExtractionRun not found.", { documentId, runId });
  return { key, run };
}

async function readDocument(deps: ConfirmRejectFieldDeps, tenantId: string, itemId: string, documentId: string) {
  const key = documentKey(tenantId, itemId, documentId);
  const document = await deps.documents.get<Document>(key);
  if (!document || document.tenantId !== tenantId) throw new NotFoundError("Document not found.", { itemId, documentId });
  return { key, document };
}

async function readItem(deps: ConfirmRejectFieldDeps, tenantId: string, itemId: string) {
  const key = itemKey(tenantId, itemId);
  const item = await deps.items.get<ExpirationItem>(key);
  if (!item || item.tenantId !== tenantId) throw new NotFoundError("ExpirationItem not found.", { itemId });
  return { key, item };
}

function assertVersion(entity: string, expected: number, actual: number, details: Record<string, unknown>): void {
  if (expected !== actual) {
    throw new ConflictError(`${entity} version mismatch — expected ${expected}, current ${actual}.`, { ...details, expected, actual });
  }
}

export async function confirmField(deps: ConfirmRejectFieldDeps, ctx: RequestContext, params: ConfirmFieldParams): Promise<ExtractedField> {
  authorize({ context: ctx, action: "extraction:confirm", resource: { tenantId: ctx.tenant.tenantId } });

  const tenantId = ctx.tenant.tenantId;
  const operation = "extraction.confirmField";
  const key = params.idempotencyKey;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        itemId: params.itemId,
        documentId: params.documentId,
        runId: params.runId,
        fieldName: params.fieldName,
        expectedItemVersion: params.expectedItemVersion,
        expectedDocumentVersion: params.expectedDocumentVersion,
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
    const outcome = await doConfirmField(deps, tenantId, params);
    await deps.idempotency.complete({ tenantId, operation, key, responseRef: params.fieldName });
    return outcome;
  } catch (err) {
    await deps.idempotency.abort({ tenantId, operation, key });
    throw err;
  }
}

async function doConfirmField(deps: ConfirmRejectFieldDeps, tenantId: string, params: ConfirmFieldParams): Promise<ExtractedField> {
  const field = await readField(deps, tenantId, params.documentId, params.fieldName, params.runId);
  const { key: runKey, run } = await readRun(deps, tenantId, params.documentId, params.runId);
  const { key: documentKeyResolved, document } = await readDocument(deps, tenantId, params.itemId, params.documentId);
  const { key: itemKeyResolved, item } = await readItem(deps, tenantId, params.itemId);

  assertVersion("ExtractedField", params.expectedFieldVersion, field.version, { fieldName: params.fieldName });
  assertVersion("ExtractionRun", params.expectedRunVersion, run.version, { runId: params.runId });
  assertVersion("Document", params.expectedDocumentVersion, document.version, { documentId: params.documentId });
  assertVersion("ExpirationItem", params.expectedItemVersion, item.version, { itemId: params.itemId });

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
  const itemAttribute = ITEM_ATTRIBUTE_BY_FIELD_NAME[field.fieldName];
  const itemUpdate =
    itemAttribute === "dueDate"
      ? { dueDate: params.confirmedValue, ...gsi1Keys(tenantId, item.status, params.confirmedValue, params.itemId) }
      : itemAttribute
        ? { [itemAttribute]: params.confirmedValue }
        : undefined;

  const outcome = await deps.fields.confirmField({
    fieldKey: field,
    fieldTenantId: tenantId,
    fieldExpectedVersion: params.expectedFieldVersion,
    confirmedValue: params.confirmedValue,
    runKey,
    runExpectedVersion: params.expectedRunVersion,
    documentKey: documentKeyResolved,
    documentExpectedVersion: params.expectedDocumentVersion,
    itemKey: itemKeyResolved,
    itemTenantId: tenantId,
    itemExpectedVersion: params.expectedItemVersion,
    itemUpdate,
    now,
  });

  if (outcome === "VERSION_CONFLICT") {
    throw new ConflictError("Version conflict while confirming field — one of item/document/run/field changed concurrently.", {
      itemId: params.itemId,
      documentId: params.documentId,
      runId: params.runId,
      fieldName: params.fieldName,
    });
  }

  return { ...field, state: "CONFIRMED", confirmedValue: params.confirmedValue, version: field.version + 1, updatedAt: now };
}

export async function rejectField(deps: ConfirmRejectFieldDeps, ctx: RequestContext, params: RejectFieldParams): Promise<ExtractedField> {
  authorize({ context: ctx, action: "extraction:confirm", resource: { tenantId: ctx.tenant.tenantId } });

  const tenantId = ctx.tenant.tenantId;
  const operation = "extraction.rejectField";
  const key = params.idempotencyKey;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        itemId: params.itemId,
        documentId: params.documentId,
        runId: params.runId,
        fieldName: params.fieldName,
        expectedDocumentVersion: params.expectedDocumentVersion,
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
    const outcome = await doRejectField(deps, tenantId, params);
    await deps.idempotency.complete({ tenantId, operation, key, responseRef: params.fieldName });
    return outcome;
  } catch (err) {
    await deps.idempotency.abort({ tenantId, operation, key });
    throw err;
  }
}

async function doRejectField(deps: ConfirmRejectFieldDeps, tenantId: string, params: RejectFieldParams): Promise<ExtractedField> {
  const field = await readField(deps, tenantId, params.documentId, params.fieldName, params.runId);
  const { key: runKey, run } = await readRun(deps, tenantId, params.documentId, params.runId);
  const { key: documentKeyResolved, document } = await readDocument(deps, tenantId, params.itemId, params.documentId);

  assertVersion("ExtractedField", params.expectedFieldVersion, field.version, { fieldName: params.fieldName });
  assertVersion("ExtractionRun", params.expectedRunVersion, run.version, { runId: params.runId });
  assertVersion("Document", params.expectedDocumentVersion, document.version, { documentId: params.documentId });

  if (field.state !== "PENDING_CONFIRMATION") {
    throw new BusinessRuleError(`ExtractedField is not pending confirmation (state=${field.state}).`, { fieldName: params.fieldName, state: field.state });
  }

  const now = deps.now();
  const outcome = await deps.fields.rejectField({
    fieldKey: field,
    fieldTenantId: tenantId,
    fieldExpectedVersion: params.expectedFieldVersion,
    correctionReason: params.correctionReason,
    runKey,
    runExpectedVersion: params.expectedRunVersion,
    documentKey: documentKeyResolved,
    documentExpectedVersion: params.expectedDocumentVersion,
    now,
  });

  if (outcome === "VERSION_CONFLICT") {
    throw new ConflictError("Version conflict while rejecting field — one of document/run/field changed concurrently.", {
      itemId: params.itemId,
      documentId: params.documentId,
      runId: params.runId,
      fieldName: params.fieldName,
    });
  }

  const result: ExtractedField = { ...field, state: "REJECTED", version: field.version + 1, updatedAt: now };
  if (params.correctionReason !== undefined) result.correctionReason = params.correctionReason;
  return result;
}
