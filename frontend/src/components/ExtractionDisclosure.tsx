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
 * This is READ-ONLY (the disclosure itself) — confirming/rejecting a suggested value is a
 * separate control, not built here yet (the HTTP routes exist, `extraction:confirm` on both
 * modules, but the interactive UI is out of scope for this slice).
 */
import { presentExtractedFieldDisclosure } from "../api/presentation.js";
import type { DisclosedExtractedField, ExtractionDisclosure as ExtractionDisclosureData } from "../api/types.js";
import { StatusBadge } from "./ui/StatusBadge.js";
import "./ExtractionDisclosure.css";

const FIELD_LABEL: Record<string, string> = {
  expirationDate: "Data de validade",
};

function FieldRow({ field }: { field: DisclosedExtractedField }) {
  const view = presentExtractedFieldDisclosure(field);
  const label = FIELD_LABEL[field.fieldName] ?? field.fieldName;

  return (
    <li className="extraction-disclosure__row">
      <span className="extraction-disclosure__field-name">{label}</span>
      <span className="extraction-disclosure__value">{view.valueText ?? "—"}</span>
      {view.suggestionLabel ? <StatusBadge presentation={{ label: view.suggestionLabel, tone: "info" }} srPrefix="Situação da sugestão" /> : null}
      {view.confirmationLabel ? <StatusBadge presentation={{ label: view.confirmationLabel, tone: "neutral" }} srPrefix="Situação da confirmação" /> : null}
      {view.rejectedLabel ? <StatusBadge presentation={{ label: view.rejectedLabel, tone: "danger" }} srPrefix="Situação do campo" /> : null}
      {view.provenanceLabel ? <span className="extraction-disclosure__provenance u-text-secondary">{view.provenanceLabel}</span> : null}
    </li>
  );
}

export function ExtractionDisclosure({ disclosure }: { disclosure: ExtractionDisclosureData | null | undefined }) {
  if (!disclosure || disclosure.fields.length === 0) return null;

  return (
    <ul className="extraction-disclosure" aria-label="Sugestões extraídas automaticamente">
      {disclosure.fields.map((field) => (
        <FieldRow key={field.fieldName} field={field} />
      ))}
    </ul>
  );
}
