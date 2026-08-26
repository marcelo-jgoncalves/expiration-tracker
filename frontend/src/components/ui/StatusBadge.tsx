/**
 * StatusBadge (mission §31) — a compact, non-interactive attribute of a record.
 *
 * Epistemic Integrity (mission §9/§96) is enforced by construction, not by convention:
 *  - the visual tone comes from `api/presentation.ts`'s `StatusPresentation.tone`, which is
 *    the single place domain state is mapped to a claim. A call site cannot pick a friendlier
 *    tone than the domain supports, because it does not pick the tone at all;
 *  - `success` exists in the token set but NO domain mapping in `presentation.ts` emits it.
 *    That is intentional: this domain has no state that proves "tudo certo" (`SATISFIED` is a
 *    recorded link, `CLEAN` is a malware scan). A green "success" badge would be a stronger
 *    claim than the system can make. It is reserved for a future state that genuinely proves
 *    one, and reviewers should treat any new `success` mapping as a Type 1 change.
 */
import type { StatusPresentation } from "../../api/presentation.js";
import "./StatusBadge.css";

/** Visual tones available to the system. `presentation.ts` currently emits only the first
 * four via `toBadgeTone` below. */
export type BadgeTone = "neutral" | "info" | "warning" | "critical" | "success";

export function toBadgeTone(tone: StatusPresentation["tone"]): BadgeTone {
  switch (tone) {
    case "danger":
      return "critical";
    case "warning":
      return "warning";
    case "neutral":
      return "neutral";
  }
}

export interface StatusBadgeProps {
  /** The already-mapped presentation from `api/presentation.ts`. */
  presentation: StatusPresentation;
  /** Prefix read only by assistive technology, so "Ativo" is not announced as a bare word
   * floating in a table cell. Visually the column header already supplies this. */
  srPrefix?: string;
  /** Allow the label to wrap (long pt-BR status copy inside a narrow column). */
  wrap?: boolean;
}

export function StatusBadge({ presentation, srPrefix, wrap }: StatusBadgeProps) {
  const tone = toBadgeTone(presentation.tone);
  return (
    <span className={`ui-badge ui-badge--${tone}${wrap ? " ui-badge--wrap" : ""}`} data-tone={presentation.tone}>
      <span className="ui-badge__marker" aria-hidden="true" />
      {srPrefix ? <span className="u-visually-hidden">{srPrefix}: </span> : null}
      {presentation.label}
    </span>
  );
}
