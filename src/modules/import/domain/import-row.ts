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
  | "DOCUMENT_TYPE_NOT_FOUND";

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
