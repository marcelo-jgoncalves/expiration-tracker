/**
 * ExtractionDisclosure — D-349 (`docs/architecture/reviews/p0-screen-a12-ocr-drift-scoping/`,
 * converged Claude 9.1/Codex 9.1). Shared between A07 (`ItemDocuments.tsx`) and A12
 * (`DocumentDetail.tsx`) — same `ExtractedField` shape, same presentation rules
 * (`api/presentation.ts#presentExtractedFieldDisclosure`), no per-screen fork of the labels.
 *
 * Renders nothing when `disclosure` is `null` (extraction never produced a run for this
 * document's current version — a normal state, e.g. IA/OCR disabled in this environment, D-342)
 * or when it produced a run with no fields yet — never a fabricated "loading"/"pending" row for
 * data that genuinely does not exist.
 *
 * Confirming/rejecting a suggested value (`extraction:confirm`) is wired via the optional
 * `actions` prop (2026-09-29) — each screen supplies its own callbacks because the OCC versions
 * a confirm/reject request needs (item/document/run/field) come from different sources on each
 * screen (A07: item+document; A12: DocumentVersion), never from this shared component itself.
 * Omitting `actions` keeps this component's original read-only behavior.
 */
import { useState } from "react";
import { presentExtractedFieldDisclosure } from "../api/presentation.js";
import type { DisclosedExtractedField, ExtractionDisclosure as ExtractionDisclosureData } from "../api/types.js";
import { StatusBadge } from "./ui/StatusBadge.js";
import { Button } from "./ui/Button.js";
import { TextField } from "./forms/TextField.js";
import { InlineNotice } from "./ui/InlineNotice.js";
import "./ExtractionDisclosure.css";

const FIELD_LABEL: Record<string, string> = {
  expirationDate: "Data de validade",
};

export interface ExtractionDisclosureActions {
  onConfirm: (field: DisclosedExtractedField, confirmedValue: string) => Promise<void>;
  onReject: (field: DisclosedExtractedField, correctionReason?: string) => Promise<void>;
  /** Which field (by name) currently has a confirm/reject request in flight - disables both
   * controls on every OTHER row so two concurrent mutations against the same run never race. */
  pendingFieldName?: string;
  /** Surfaced under the row whose confirm/reject just failed - the caller decides the message
   * (e.g. a conflict gets "outra pessoa já decidiu", others fall back to the raw ApiError). */
  errorFieldName?: string;
  errorMessage?: string;
}

function FieldRow({ field, actions }: { field: DisclosedExtractedField; actions?: ExtractionDisclosureActions }) {
  const view = presentExtractedFieldDisclosure(field);
  const label = FIELD_LABEL[field.fieldName] ?? field.fieldName;
  const [confirmValue, setConfirmValue] = useState(field.candidateValue ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const isPending = actions?.pendingFieldName === field.fieldName;
  const anyPending = actions?.pendingFieldName !== undefined;

  async function handleConfirm() {
    if (!actions || !confirmValue) return;
    await actions.onConfirm(field, confirmValue);
  }

  async function handleReject() {
    if (!actions) return;
    await actions.onReject(field, correctionReason.trim() || undefined);
    setRejecting(false);
    setCorrectionReason("");
  }

  return (
    <li className="extraction-disclosure__row">
      <span className="extraction-disclosure__field-name">{label}</span>
      <span className="extraction-disclosure__value">{view.valueText ?? "—"}</span>
      {view.suggestionLabel ? <StatusBadge presentation={{ label: view.suggestionLabel, tone: "info" }} srPrefix="Situação da sugestão" /> : null}
      {view.confirmationLabel ? <StatusBadge presentation={{ label: view.confirmationLabel, tone: "neutral" }} srPrefix="Situação da confirmação" /> : null}
      {view.rejectedLabel ? <StatusBadge presentation={{ label: view.rejectedLabel, tone: "danger" }} srPrefix="Situação do campo" /> : null}
      {view.provenanceLabel ? <span className="extraction-disclosure__provenance u-text-secondary">{view.provenanceLabel}</span> : null}
      {actions && field.state === "PENDING_CONFIRMATION" ? (
        <div className="extraction-disclosure__actions">
          {actions.errorFieldName === field.fieldName && actions.errorMessage ? (
            <InlineNotice tone="warning" announce="alert">
              {actions.errorMessage}
            </InlineNotice>
          ) : null}
          {rejecting ? (
            <span className="ui-form__row">
              <TextField label="Motivo da rejeição" value={correctionReason} onChange={setCorrectionReason} hideLabel placeholder="Motivo da rejeição (opcional)" />
              <Button variant="danger" size="sm" pending={isPending} disabled={anyPending && !isPending} onClick={() => void handleReject()}>
                {isPending ? "Rejeitando…" : "Confirmar rejeição"}
              </Button>
              <Button variant="secondary" size="sm" disabled={anyPending} onClick={() => setRejecting(false)}>
                Cancelar
              </Button>
            </span>
          ) : (
            <span className="ui-form__row">
              <TextField label={`${label} confirmado`} value={confirmValue} onChange={setConfirmValue} type="date" hideLabel />
              <Button variant="primary" size="sm" pending={isPending} disabled={!confirmValue || (anyPending && !isPending)} onClick={() => void handleConfirm()}>
                {isPending ? "Confirmando…" : "Confirmar"}
              </Button>
              <Button variant="secondary" size="sm" disabled={anyPending} onClick={() => setRejecting(true)}>
                Rejeitar
              </Button>
            </span>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function ExtractionDisclosure({ disclosure, actions }: { disclosure: ExtractionDisclosureData | null | undefined; actions?: ExtractionDisclosureActions }) {
  if (!disclosure || disclosure.fields.length === 0) return null;

  return (
    <ul className="extraction-disclosure" aria-label="Sugestões extraídas automaticamente">
      {disclosure.fields.map((field) => (
        <FieldRow key={field.fieldName} field={field} actions={actions} />
      ))}
    </ul>
  );
}
