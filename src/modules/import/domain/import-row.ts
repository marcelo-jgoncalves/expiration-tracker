/**
 * Validação/sanitização de linha de CSV de import — M11 (D-042). Defesa na fronteira de
 * ENTRADA aqui é estrutural apenas (nunca semântica de formula injection - essa defesa fica
 * na fronteira de SAÍDA, exportação/relatório futuro, per a decisão da rodada 2 do design:
 * "o risco de CSV/formula injection só se manifesta na exportação/reabertura em planilha, não
 * no armazenamento"). Valores começando com `=`/`+`/`-`/`@` são ACEITOS com warning
 * `FORMULA_LIKE_VALUE`, nunca rejeitados - rejeitar isso na entrada é defensivo demais e gera
 * falso positivo em dado legítimo (ex.: um `displayName` "-45" ou "@handle").
 */
import type { TrackedSubjectType } from "../../subject/domain/tracked-subject.js";
import type { RequirementApplicability } from "../../document-archive/domain/requirement.js";
import { MAX_NAME_BYTES } from "../../document-archive/domain/requirement-template.js";
import { normalizeCategory } from "../../expiration/domain/expiration-item.js";
import { normalizeDisplayName } from "../../../shared/text/normalize-display-name.js";
import type { ColumnMapping } from "./import-job.js";

const VALID_SUBJECT_TYPES = new Set<TrackedSubjectType>(["COMPANY", "VENDOR", "CLIENT", "EMPLOYEE", "ASSET", "LOCATION", "CUSTOM"]);

export const MAX_DISPLAY_NAME_LENGTH = 160;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 20;
/** Separador de tags DENTRO de uma célula CSV - nunca vírgula (já é o separador de campo). */
export const TAG_SEPARATOR = ";";

// eslint-disable-next-line no-control-regex -- detecção deliberada de NUL/controles/CR/LF/tab embutido num campo de célula já parseada (não é a linha CSV bruta - o parser já separou campos por vírgula real). Inclui \x09 (tab)/\x0A (LF)/\x0D (CR) de propósito - design rejeita explicitamente esses 3 embutidos num campo, mesmo que RFC4180 permita literal newline dentro de campo entre aspas.
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const FORMULA_LIKE_PATTERN = /^[=+\-@]/;

export type ImportRowWarningCode = "FORMULA_LIKE_VALUE";
export type ImportRowRejectionCode =
  | "MISSING_DISPLAY_NAME"
  | "MISSING_TYPE"
  | "INVALID_TYPE"
  | "DISPLAY_NAME_TOO_LONG"
  | "TOO_MANY_TAGS"
  | "TAG_TOO_LONG"
  | "CONTROL_CHARACTER_IN_FIELD"
  | "DUPLICATE_EXTERNAL_ID_IN_FILE"
  // D-192 (fatia 7) — Document/Requirement row shapes, §7's per-type dedupe table.
  | "MISSING_SUBJECT_REF"
  | "MISSING_DOCUMENT_TYPE_REF"
  | "MISSING_HAS_VALIDITY"
  | "INVALID_HAS_VALIDITY"
  | "MISSING_NAME"
  | "NAME_TOO_LONG"
  | "INVALID_APPLICABILITY"
  | "DUPLICATE_IN_FILE"
  | "SUBJECT_REFERENCE_NOT_FOUND"
  | "DOCUMENT_TYPE_NOT_FOUND"
  // D-3xx (fatia Item, PENDING_PROTOCOL_REVIEW) — Item row shape.
  | "MISSING_CATEGORY"
  | "CATEGORY_TOO_LONG"
  | "MISSING_DUE_DATE"
  | "INVALID_DUE_DATE"
  | "INVALID_ISSUE_DATE"
  | "DESCRIPTION_TOO_LONG"
  | "PERIODICITY_TOO_LONG"
  | "ISSUER_TOO_LONG"
  | "NUMBER_TOO_LONG"
  | "PRIORITY_TOO_LONG";

/** Uma linha crua do CSV, já dividida em campos nomeados pelo parser (csv-parser.ts) - v1 tem
 * um mapeamento de colunas fixo, não configurável. */
export interface RawImportRow {
  rowNumber: number; // 1-indexed, exclui o cabeçalho - usado em mensagens de erro ao usuário
  displayName?: string;
  type?: string;
  externalId?: string;
  notes?: string;
  tags?: string; // string única, células separadas por TAG_SEPARATOR
}

export interface ValidatedImportRow {
  rowNumber: number;
  displayName: string;
  type: TrackedSubjectType;
  externalId?: string;
  notes?: string;
  tags: string[];
  warnings: ImportRowWarningCode[];
}

export type ImportRowPlanEntry =
  | { rowNumber: number; action: "CREATE_SUBJECT"; row: ValidatedImportRow }
  | { rowNumber: number; action: "SKIP_DUPLICATE"; reason: "EXTERNAL_ID_ALREADY_EXISTS" | "DISPLAY_NAME_ALREADY_EXISTS"; externalId?: string; displayName: string }
  | { rowNumber: number; action: "REJECT"; reason: ImportRowRejectionCode; field?: string };

function checkControlChars(value: string): boolean {
  return CONTROL_CHAR_PATTERN.test(value);
}

/** Valida e sanitiza UMA linha crua - nunca lança, retorna a decisão estrutural (aceita com
 * warnings, ou motivo de rejeição). Dedup contra linhas JÁ VISTAS no mesmo arquivo E contra o
 * DynamoDB fica em import-parse-worker.ts (esta função não tem acesso a estado externo, é
 * pura e testável isoladamente). */
export function validateImportRow(raw: RawImportRow): { row: ValidatedImportRow } | { rejection: { reason: ImportRowRejectionCode; field?: string } } {
  const displayName = raw.displayName?.trim();
  if (!displayName) return { rejection: { reason: "MISSING_DISPLAY_NAME", field: "displayName" } };
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) return { rejection: { reason: "DISPLAY_NAME_TOO_LONG", field: "displayName" } };
  if (checkControlChars(displayName)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "displayName" } };

  const type = raw.type?.trim().toUpperCase();
  if (!type) return { rejection: { reason: "MISSING_TYPE", field: "type" } };
  if (!VALID_SUBJECT_TYPES.has(type as TrackedSubjectType)) return { rejection: { reason: "INVALID_TYPE", field: "type" } };

  const externalId = raw.externalId?.trim() || undefined;
  if (externalId && checkControlChars(externalId)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "externalId" } };

  const notes = raw.notes?.trim() || undefined;
  if (notes && checkControlChars(notes)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "notes" } };

  const tags = (raw.tags ?? "")
    .split(TAG_SEPARATOR)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tags.length > MAX_TAGS) return { rejection: { reason: "TOO_MANY_TAGS", field: "tags" } };
  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) return { rejection: { reason: "TAG_TOO_LONG", field: "tags" } };
    if (checkControlChars(tag)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "tags" } };
  }

  const warnings: ImportRowWarningCode[] = [];
  if (FORMULA_LIKE_PATTERN.test(displayName) || (notes && FORMULA_LIKE_PATTERN.test(notes))) {
    warnings.push("FORMULA_LIKE_VALUE");
  }

  return {
    row: {
      rowNumber: raw.rowNumber,
      displayName,
      type: type as TrackedSubjectType,
      externalId,
      notes,
      tags,
      warnings,
    },
  };
}

/*
 * D-192 §2/§7 (fatia 7) — Document/Requirement row shapes. TrackedSubject's row/plan types
 * above are UNTOUCHED (backward-compat guard, D-192's own scope boundary) — these are new
 * sibling types, not a discriminated-union rewrite of the existing ones, so the TrackedSubject
 * parse path in `import-parse-service.ts` never has to change shape.
 *
 * Extraction here is `ColumnMapping`-driven (design §2): the caller passes the job's resolved
 * `columns` mapping (one of `ColumnMapping`'s Document/Requirement variants) plus the CSV row
 * already turned into a header-keyed `Record<string,string>` by `mapCsvRowsToNamedFields()` —
 * unlike TrackedSubject's fixed `displayname`/`type`/... header names, the actual CSV header
 * text for each semantic field is whatever the mapping says it is.
 */

type DocumentColumnMapping = Extract<ColumnMapping, { targetKind: "Document" }>["columns"];
type RequirementColumnMapping = Extract<ColumnMapping, { targetKind: "Requirement" }>["columns"];

function readMappedField(namedRow: Record<string, string>, headerName: string | undefined): string | undefined {
  if (!headerName) return undefined;
  return namedRow[headerName.trim().toLowerCase()];
}

export interface RawDocumentImportRow {
  rowNumber: number;
  subjectRef?: string;
  documentTypeRef?: string;
  hasValidity?: string;
  externalId?: string;
}

export interface ValidatedDocumentImportRow {
  rowNumber: number;
  subjectRef: string;
  documentTypeRef: string;
  hasValidity: boolean;
  externalId?: string;
  warnings: ImportRowWarningCode[];
}

/** `ImportRowPlanEntry`'s Document sibling — `subjectId`/`documentTypeId` are the RESOLVED,
 * frozen ids (design §4: "o documentTypeId RESOLVIDO fica congelado no plano"), never re-derived
 * from `subjectRef`/`documentTypeRef` at commit time. No `SKIP_DUPLICATE` variant — §7's table is
 * explicit that a same-`externalId` collision within the file is a `REJECT`, not a skip (unlike
 * TrackedSubject's pre-existing-entity skip semantics). */
export type DocumentImportRowPlanEntry =
  | { rowNumber: number; action: "CREATE_DOCUMENT"; row: ValidatedDocumentImportRow; subjectId: string; documentTypeId: string }
  | { rowNumber: number; action: "REJECT"; reason: ImportRowRejectionCode; field?: string };

export function extractRawDocumentRow(namedRow: Record<string, string>, columns: DocumentColumnMapping, rowNumber: number): RawDocumentImportRow {
  return {
    rowNumber,
    subjectRef: readMappedField(namedRow, columns.subjectRef),
    documentTypeRef: readMappedField(namedRow, columns.documentTypeRef),
    hasValidity: readMappedField(namedRow, columns.hasValidity),
    externalId: readMappedField(namedRow, columns.externalId),
  };
}

const HAS_VALIDITY_TRUE = new Set(["true", "1", "yes"]);
const HAS_VALIDITY_FALSE = new Set(["false", "0", "no"]);

export function validateDocumentImportRow(raw: RawDocumentImportRow): { row: ValidatedDocumentImportRow } | { rejection: { reason: ImportRowRejectionCode; field?: string } } {
  const subjectRef = raw.subjectRef?.trim();
  if (!subjectRef) return { rejection: { reason: "MISSING_SUBJECT_REF", field: "subjectRef" } };
  if (checkControlChars(subjectRef)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "subjectRef" } };

  const documentTypeRef = raw.documentTypeRef?.trim();
  if (!documentTypeRef) return { rejection: { reason: "MISSING_DOCUMENT_TYPE_REF", field: "documentTypeRef" } };
  if (checkControlChars(documentTypeRef)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "documentTypeRef" } };

  const hasValidityRaw = raw.hasValidity?.trim().toLowerCase();
  if (!hasValidityRaw) return { rejection: { reason: "MISSING_HAS_VALIDITY", field: "hasValidity" } };
  let hasValidity: boolean;
  if (HAS_VALIDITY_TRUE.has(hasValidityRaw)) hasValidity = true;
  else if (HAS_VALIDITY_FALSE.has(hasValidityRaw)) hasValidity = false;
  else return { rejection: { reason: "INVALID_HAS_VALIDITY", field: "hasValidity" } };

  const externalId = raw.externalId?.trim() || undefined;
  if (externalId && checkControlChars(externalId)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "externalId" } };

  return { row: { rowNumber: raw.rowNumber, subjectRef, documentTypeRef, hasValidity, externalId, warnings: [] } };
}

export interface RawRequirementImportRow {
  rowNumber: number;
  subjectRef?: string;
  name?: string;
  notes?: string;
  applicability?: string;
  externalId?: string;
}

export interface ValidatedRequirementImportRow {
  rowNumber: number;
  subjectRef: string;
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
  externalId?: string;
  warnings: ImportRowWarningCode[];
}

/** `ImportRowPlanEntry`'s Requirement sibling — same "no `SKIP_DUPLICATE`, collision is a
 * `REJECT`" posture as `DocumentImportRowPlanEntry` (§7). */
export type RequirementImportRowPlanEntry =
  | { rowNumber: number; action: "CREATE_REQUIREMENT"; row: ValidatedRequirementImportRow; subjectId: string }
  | { rowNumber: number; action: "REJECT"; reason: ImportRowRejectionCode; field?: string };

export function extractRawRequirementRow(namedRow: Record<string, string>, columns: RequirementColumnMapping, rowNumber: number): RawRequirementImportRow {
  return {
    rowNumber,
    subjectRef: readMappedField(namedRow, columns.subjectRef),
    name: readMappedField(namedRow, columns.name),
    notes: readMappedField(namedRow, columns.notes),
    applicability: readMappedField(namedRow, columns.applicability),
    externalId: readMappedField(namedRow, columns.externalId),
  };
}

export function validateRequirementImportRow(raw: RawRequirementImportRow): { row: ValidatedRequirementImportRow } | { rejection: { reason: ImportRowRejectionCode; field?: string } } {
  const subjectRef = raw.subjectRef?.trim();
  if (!subjectRef) return { rejection: { reason: "MISSING_SUBJECT_REF", field: "subjectRef" } };
  if (checkControlChars(subjectRef)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "subjectRef" } };

  const name = raw.name?.trim();
  if (!name) return { rejection: { reason: "MISSING_NAME", field: "name" } };
  if (checkControlChars(name)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "name" } };
  // Qualification #2 (design §9): Requirement.name's 200-byte budget is not yet a universal
  // domain invariant (createRequirement() doesn't enforce it) - bulk import reuses
  // `MAX_NAME_BYTES` explicitly here anyway, per the design's own registered pre-requisite,
  // rather than waiting for a hypothetical future unification of every Requirement.name path.
  if (Buffer.byteLength(name, "utf-8") > MAX_NAME_BYTES) return { rejection: { reason: "NAME_TOO_LONG", field: "name" } };

  const notes = raw.notes?.trim() || undefined;
  if (notes && checkControlChars(notes)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "notes" } };

  const applicabilityRaw = raw.applicability?.trim().toUpperCase();
  let applicability: RequirementApplicability;
  if (!applicabilityRaw || applicabilityRaw === "APPLICABLE") applicability = "APPLICABLE";
  else if (applicabilityRaw === "NOT_APPLICABLE") applicability = "NOT_APPLICABLE";
  else return { rejection: { reason: "INVALID_APPLICABILITY", field: "applicability" } };

  const externalId = raw.externalId?.trim() || undefined;
  if (externalId && checkControlChars(externalId)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "externalId" } };

  return { row: { rowNumber: raw.rowNumber, subjectRef, name, notes, applicability, externalId, warnings: [] } };
}

/*
 * D-3xx (2026-09-21, PENDING_PROTOCOL_REVIEW) — Item row shape. `ExpirationItem` has no
 * `subjectId`/`requirementId` (confirmed in `expiration/domain/expiration-item.ts` - it is a
 * standalone aggregate), so extraction here needs no reference-resolution phase - closer in
 * shape to TrackedSubject's fixed extraction above than to Document/Requirement's
 * ref-resolving one, even though it reuses `ColumnMapping`-driven `readMappedField()` (D-3xx
 * decision 1: kept the mapping indirection for consistency with the other 2 slices that added a
 * `ColumnMapping` variant, even though v1 always seeds `DEFAULT_ITEM_COLUMN_MAPPING`).
 */

type ItemColumnMapping = Extract<ColumnMapping, { targetKind: "Item" }>["columns"];

export interface RawItemImportRow {
  rowNumber: number;
  name?: string;
  category?: string;
  dueDate?: string;
  description?: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  tags?: string;
  priority?: string;
}

export interface ValidatedItemImportRow {
  rowNumber: number;
  name: string;
  category: string;
  dueDate: string; // normalized full ISO-8601 date-time (create-item-request.v1.json's "date-time" format)
  description?: string;
  issueDate?: string;
  periodicity?: string;
  issuer?: string;
  number?: string;
  tags: string[];
  priority?: string;
  warnings: ImportRowWarningCode[];
}

/** `ImportRowPlanEntry`'s Item sibling. Unlike Document/Requirement (D-192 §7: same-row
 * collision is always a REJECT, never a SKIP), Item DOES have a `SKIP_DUPLICATE` variant - same
 * posture as TrackedSubject, because Item's commit path reuses TrackedSubject's two-call
 * claim-then-create dance (no domain fence to resolve, `import-commit-service.ts`), not
 * Document/Requirement's TENTATIVA/FALLBACK transaction protocol (which exists specifically to
 * handle a resolved-reference going stale between preview and commit - Item has no such
 * reference). `dedupKey` is the synthetic composite natural key (decision 3 below), carried in
 * the plan so the commit worker never has to recompute normalization. */
export type ItemImportRowPlanEntry =
  | { rowNumber: number; action: "CREATE_ITEM"; row: ValidatedItemImportRow; dedupKey: string }
  | { rowNumber: number; action: "SKIP_DUPLICATE"; reason: "ITEM_ALREADY_IMPORTED"; name: string }
  | { rowNumber: number; action: "REJECT"; reason: ImportRowRejectionCode; field?: string };

export function extractRawItemRow(namedRow: Record<string, string>, columns: ItemColumnMapping, rowNumber: number): RawItemImportRow {
  return {
    rowNumber,
    name: readMappedField(namedRow, columns.name),
    category: readMappedField(namedRow, columns.category),
    dueDate: readMappedField(namedRow, columns.dueDate),
    description: readMappedField(namedRow, columns.description),
    issueDate: readMappedField(namedRow, columns.issueDate),
    periodicity: readMappedField(namedRow, columns.periodicity),
    issuer: readMappedField(namedRow, columns.issuer),
    number: readMappedField(namedRow, columns.number),
    tags: readMappedField(namedRow, columns.tags),
    priority: readMappedField(namedRow, columns.priority),
  };
}

// Mirrors create-item-request.v1.json's per-field length caps exactly (import writes directly
// through ExpirationService.createItem(), which never re-validates against that JSON schema -
// these limits keep an imported Item indistinguishable from one created interactively, rather
// than inventing a separate, looser budget).
const MAX_ITEM_NAME_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_PERIODICITY_LENGTH = 50;
const MAX_ISSUER_LENGTH = 200;
const MAX_NUMBER_LENGTH = 100;
const MAX_PRIORITY_LENGTH = 50;

const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// RFC3339 date-time (matches ajv's "date-time" format, the same one create-item-request.v1.json
// validates against at the interactive HTTP boundary). Captures y/m/d so the timestamp branch can
// run the SAME calendar-validity check as the plain-date branch (round-1 Codex finding: a
// syntactically valid but calendar-impossible timestamp like "2026-02-30T00:00:00Z" used to pass
// through unrejected - `Date.parse` silently rolls it forward to March 2nd instead of erroring).
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Round-2 Codex finding: the regex alone accepts an hour of "24" (e.g. "2026-12-31T24:00:00Z"),
// which `Date.parse`/`new Date(...)` silently rolls forward into the NEXT day at midnight instead
// of rejecting - the calendar-date check alone doesn't catch this, since the date part itself is
// valid. RFC3339 (unlike some ISO-8601 profiles) never allows "24:00:00" as a same-day sentinel,
// so this is rejected outright rather than special-cased into "next day".
function isValidClockTime(h: number, mi: number, s: number): boolean {
  return h <= 23 && mi <= 59 && s <= 59;
}

/** Accepts either a bare `YYYY-MM-DD` (normalized to midnight UTC - real-world CSV date columns
 * are plain dates far more often than full timestamps, D-3xx decision 1) or an already-full
 * ISO-8601 date-time string; rejects anything else, including a syntactically date-shaped but
 * calendar-invalid value (e.g. "2026-02-30", now rejected in BOTH branches - round-1 Codex
 * finding, the timestamp branch used to only regex-match, never calendar-validate).
 *
 * Always returns the value canonicalized via `Date.parse(...).toISOString()` (round-1 Codex
 * finding: `"2026-12-31"`, `"2026-12-31T00:00:00Z"`, and `"2026-12-30T21:00:00-03:00"` are the
 * SAME instant but, before this fix, produced three different strings - which meant
 * `buildItemDedupKey()` never caught them as the same dueDate, letting an equivalent-but-
 * differently-formatted re-import slip past dedup). Exported for reuse by
 * `import-parse-service.ts` test fixtures - never re-implemented at the call site. */
export function normalizeCsvDateTime(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (PLAIN_DATE_PATTERN.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number) as [number, number, number];
    if (!isValidCalendarDate(y, m, d)) return undefined;
    return new Date(Date.UTC(y, m - 1, d)).toISOString();
  }
  const match = DATE_TIME_PATTERN.exec(trimmed);
  if (match) {
    const [, yStr, mStr, dStr, hStr, miStr, sStr] = match;
    if (!isValidCalendarDate(Number(yStr), Number(mStr), Number(dStr))) return undefined;
    if (!isValidClockTime(Number(hStr), Number(miStr), Number(sStr))) return undefined;
    const parsedMs = Date.parse(trimmed);
    if (Number.isNaN(parsedMs)) return undefined;
    return new Date(parsedMs).toISOString();
  }
  return undefined;
}

export function validateItemImportRow(raw: RawItemImportRow): { row: ValidatedItemImportRow } | { rejection: { reason: ImportRowRejectionCode; field?: string } } {
  const name = raw.name?.trim();
  if (!name) return { rejection: { reason: "MISSING_NAME", field: "name" } };
  if (name.length > MAX_ITEM_NAME_LENGTH) return { rejection: { reason: "NAME_TOO_LONG", field: "name" } };
  if (checkControlChars(name)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "name" } };

  const category = raw.category?.trim();
  if (!category) return { rejection: { reason: "MISSING_CATEGORY", field: "category" } };
  if (category.length > MAX_CATEGORY_LENGTH) return { rejection: { reason: "CATEGORY_TOO_LONG", field: "category" } };
  if (checkControlChars(category)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "category" } };

  const dueDateRaw = raw.dueDate?.trim();
  if (!dueDateRaw) return { rejection: { reason: "MISSING_DUE_DATE", field: "dueDate" } };
  const dueDate = normalizeCsvDateTime(dueDateRaw);
  if (!dueDate) return { rejection: { reason: "INVALID_DUE_DATE", field: "dueDate" } };

  let issueDate: string | undefined;
  const issueDateRaw = raw.issueDate?.trim();
  if (issueDateRaw) {
    issueDate = normalizeCsvDateTime(issueDateRaw);
    if (!issueDate) return { rejection: { reason: "INVALID_ISSUE_DATE", field: "issueDate" } };
  }

  const description = raw.description?.trim() || undefined;
  if (description) {
    if (description.length > MAX_DESCRIPTION_LENGTH) return { rejection: { reason: "DESCRIPTION_TOO_LONG", field: "description" } };
    if (checkControlChars(description)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "description" } };
  }

  const periodicity = raw.periodicity?.trim() || undefined;
  if (periodicity) {
    if (periodicity.length > MAX_PERIODICITY_LENGTH) return { rejection: { reason: "PERIODICITY_TOO_LONG", field: "periodicity" } };
    if (checkControlChars(periodicity)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "periodicity" } };
  }

  const issuer = raw.issuer?.trim() || undefined;
  if (issuer) {
    if (issuer.length > MAX_ISSUER_LENGTH) return { rejection: { reason: "ISSUER_TOO_LONG", field: "issuer" } };
    if (checkControlChars(issuer)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "issuer" } };
  }

  const number = raw.number?.trim() || undefined;
  if (number) {
    if (number.length > MAX_NUMBER_LENGTH) return { rejection: { reason: "NUMBER_TOO_LONG", field: "number" } };
    if (checkControlChars(number)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "number" } };
  }

  const priority = raw.priority?.trim() || undefined;
  if (priority) {
    if (priority.length > MAX_PRIORITY_LENGTH) return { rejection: { reason: "PRIORITY_TOO_LONG", field: "priority" } };
    if (checkControlChars(priority)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "priority" } };
  }

  // Same tag rules (separator/limits) as TrackedSubject - reused verbatim, never redefined.
  const tags = (raw.tags ?? "")
    .split(TAG_SEPARATOR)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tags.length > MAX_TAGS) return { rejection: { reason: "TOO_MANY_TAGS", field: "tags" } };
  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) return { rejection: { reason: "TAG_TOO_LONG", field: "tags" } };
    if (checkControlChars(tag)) return { rejection: { reason: "CONTROL_CHARACTER_IN_FIELD", field: "tags" } };
  }

  const warnings: ImportRowWarningCode[] = [];
  if (FORMULA_LIKE_PATTERN.test(name) || (description && FORMULA_LIKE_PATTERN.test(description))) {
    warnings.push("FORMULA_LIKE_VALUE");
  }

  return {
    row: { rowNumber: raw.rowNumber, name, category, dueDate, description, issueDate, periodicity, issuer, number, tags, priority, warnings },
  };
}

/** D-3xx decision 3 (dedup strategy): `ExpirationItem` has no natural-key field at all (no
 * `externalId`, no small bounded corpus to preload like TrackedSubject's GSI7) - the composite
 * key below is the synthetic substitute persisted into `ImportDedupRecord.externalId`
 * (`import-dedup.ts`'s "ITEM" kind), scoped to catching a REIMPORT of the same row across import
 * jobs, never a collision against an Item created outside of import (documented limitation,
 * same posture Document/Requirement's own externalId-only dedup already has - no full-tenant
 * scan, doesn't scale to the 10k+ item volumes that motivated this feature, PERF-12). `dueDate`
 * is included (not just category+name) because a legitimately recurring item of the same
 * name/category with a DIFFERENT due date (e.g. next year's same renewal) must never be treated
 * as a duplicate of a previous one. */
export function buildItemDedupKey(category: string, name: string, dueDate: string): string {
  // JSON.stringify of a tuple, never raw `|`-joined interpolation (round-1 Codex finding: a plain
  // `${a}|${b}|${c}` join lets category="a|b"/name="c" collide with category="a"/name="b|c" - both
  // produce the literal string "a|b|c". JSON-encoding each field escapes any `|`/quote it contains,
  // so two different (category, name) pairs can never produce the same key.
  return JSON.stringify([normalizeCategory(category), normalizeDisplayName(name), dueDate]);
}
