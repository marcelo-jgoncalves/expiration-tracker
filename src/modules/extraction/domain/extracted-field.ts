/**
 * ExtractedField — um campo candidato produzido por um `ExtractionRun` (M7).
 * `implementation-blueprint.md` §12.5 (exemplo de payload) + `data-model.md` linha 107: mesma
 * PK do `ExtractionRun` pai (`TENANT#t#DOC#d`), SK `FIELD#<fieldName>#<runId>` — não precisa de
 * chave de idempotência própria, é sempre escrito uma vez por `ExtractionRun` já idempotente.
 *
 * Nunca altera `ExpirationItem` por si só - a transição PENDING_CONFIRMATION -> CONFIRMED só
 * acontece via a rota HTTP de confirmação (fora deste arquivo), que exige
 * expectedItemVersion/expectedDocumentVersion/expectedRunVersion/expectedFieldVersion e roda em
 * transação (implementation-blueprint.md §12.5 "Confirmação humana").
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ExtractedFieldValueType = "DATE" | "STRING" | "NUMBER";

/** Which extractor(s) produced a candidate for this field. Bedrock only appears here when
 * `decide-bedrock.ts`'s needsBedrock() returned true for this field. */
export type ExtractionSource = "DETERMINISTIC_PARSER" | "TEXTRACT" | "BEDROCK";

/** SINGLE_SOURCE: only one extractor produced a candidate (no cross-check possible). MATCH:
 * 2+ sources agreed. MISMATCH: 2+ sources disagreed - always routes to PENDING_CONFIRMATION,
 * never auto-resolved by picking a "winning" source. */
export type ExtractionAgreement = "SINGLE_SOURCE" | "MATCH" | "MISMATCH";

export type ExtractedFieldState = "PENDING_CONFIRMATION" | "CONFIRMED" | "REJECTED";

export interface ExtractedField extends EntityKey {
  entityType: "ExtractedField";
  tenantId: string;
  documentId: string;
  runId: string;
  fieldName: string;
  valueType: ExtractedFieldValueType;
  candidateValue?: string;
  confidence?: number;
  sources: readonly ExtractionSource[];
  agreement: ExtractionAgreement;
  state: ExtractedFieldState;
  /** Set only when state === "CONFIRMED" - the value actually applied to the item, which may
   * differ from candidateValue if the confirming user corrected it (implementation-blueprint.md
   * §12.5's confirm body carries `confirmedValue` explicitly for this reason). */
  confirmedValue?: string;
  correctionReason?: string;
  documentVersion: number;
  pipelineVersion: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function extractedFieldKey(tenantId: string, documentId: string, fieldName: string, runId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#DOC#${documentId}`, SK: `FIELD#${fieldName}#${runId}` };
}
