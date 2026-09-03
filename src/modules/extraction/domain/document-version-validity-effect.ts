/**
 * planDocumentVersionValidityEffect — D-193 item 4/9 (`estado-final-consolidado.md`, "Transação
 * de confirmação — cardinalidade fixa, Requirement nunca dentro dela"): the single pure planner
 * shared by BOTH the manual confirm route (`confirm-reject-field-document-archive.ts`'s
 * `doConfirmFieldForDocumentArchive`) and the pipeline's auto-confirm path
 * (`run-extraction-validation.ts`'s `persistExtractedFieldsStage`) so both produce the identical
 * `DocumentVersion.validUntil` effect from identical inputs — checklist criterion 5 (10%):
 * "caminho automático e humano produzem o mesmo efeito por construção (planner único)". Never
 * mutates anything itself — returns a plan the caller applies inside its own transaction, and
 * never touches `Requirement` (async convergence via outbox is item 5/9, a separate slice).
 *
 * Only `expirationDate` (schema v1's one field with a version-facing effect — the
 * `document-archive` mirror of `item-field-mapping.ts`'s `ITEM_ATTRIBUTE_BY_FIELD_NAME`, which
 * maps the same field to the OLD `document` module's `ExpirationItem.dueDate`) ever produces a
 * `SET` effect. Every other field name plans `NO_CHANGE` by construction.
 *
 * A `DocumentVersion` outside `RECEIVED`/`UNDER_REVIEW`/`ACCEPTED` — the same eligible-state set
 * the Starter's precondition 4 already enforces (`start-extraction-run-for-document-archive.ts`)
 * — plans `NO_CHANGE`: confirming a field must never resurrect or alter a
 * `REJECTED`/`SUPERSEDED`/`WITHDRAWN`/`DRAFT` version's `validUntil`.
 *
 * A confirmation whose resulting value is byte-identical to the version's current `validUntil`
 * also plans `NO_CHANGE` — this is what makes the confirm transaction's outbox write genuinely
 * conditional (design: "só quando há mudança real de validUntil"), not an always-fired side
 * effect gated on nothing.
 */
import type { DocumentVersion, DocumentVersionState } from "../../document-archive/domain/document-version.js";

/** The one schema v1 field this planner ever acts on — mirrors
 * `item-field-mapping.ts`'s `ITEM_ATTRIBUTE_BY_FIELD_NAME` key for the OLD `document` module. */
export const DOCUMENT_VERSION_VALIDITY_FIELD_NAME = "expirationDate";

/** Same eligible-state set as the Starter's precondition 4 (`start-extraction-run-for-document-
 * archive.ts`) — confirming a field is never allowed to have a wider reach than starting a run
 * against that version did in the first place. */
const ELIGIBLE_STATES: readonly DocumentVersionState[] = ["RECEIVED", "UNDER_REVIEW", "ACCEPTED"];

export type DocumentVersionValidityEffect = { kind: "SET"; validUntil: string } | { kind: "NO_CHANGE" };

export interface PlanDocumentVersionValidityEffectInput {
  fieldName: string;
  confirmedValue: string;
  documentVersion: Pick<DocumentVersion, "state" | "validUntil">;
}

export function planDocumentVersionValidityEffect(input: PlanDocumentVersionValidityEffectInput): DocumentVersionValidityEffect {
  if (input.fieldName !== DOCUMENT_VERSION_VALIDITY_FIELD_NAME) return { kind: "NO_CHANGE" };
  if (!ELIGIBLE_STATES.includes(input.documentVersion.state)) return { kind: "NO_CHANGE" };
  if (input.documentVersion.validUntil === input.confirmedValue) return { kind: "NO_CHANGE" };
  return { kind: "SET", validUntil: input.confirmedValue };
}
