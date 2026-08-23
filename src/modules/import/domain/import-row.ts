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
  | "DUPLICATE_EXTERNAL_ID_IN_FILE";

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
