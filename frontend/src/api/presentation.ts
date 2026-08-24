/**
 * Domain -> presentation semantic state mapping, centralized (Frontend Production Foundation
 * mission §48) so this rule lives in exactly one place instead of being re-derived (and
 * re-broken) at every call site:
 *
 *   View models must never transform a domain state into a claim stronger than the domain
 *   actually supports (mission §47, the same Epistemic Integrity rule established in
 *   docs/frontend/interface-conceptual-model-and-information-architecture.md §44 -
 *   Document.CLEAN never became "Arquivo verificado"/"Aprovado" in the interface planning
 *   docs, and the same discipline applies to real component code from day one, not added
 *   later as a fix).
 *
 * Every function here is a pure, testable mapping - no component should invent its own label
 * for a domain status.
 */
import type { ExpirationItemStatus } from "./types.js";

export interface StatusPresentation {
  label: string;
  /** Semantic tone for structural styling (never color-only per WCAG 1.4.1, matching the
   * prototype's established convention of pairing status with a text label always). */
  tone: "neutral" | "warning" | "danger";
}

/**
 * Deliberately does NOT compute "overdue"/"due soon" here - that requires a caller-supplied
 * `now`/`daysUntil`, which this pure status-only mapping has no business injecting a clock
 * into. Urgency presentation (VENCIDO/VENCE EM BREVE, per the approved wireframes) belongs to
 * a caller that already has both the item's dueDate and a clock - seeing that composed
 * correctly is a First Vertical Slice concern, not this foundation's.
 */
export function presentItemStatus(status: ExpirationItemStatus): StatusPresentation {
  switch (status) {
    case "ACTIVE":
      return { label: "Ativo", tone: "neutral" };
    case "ARCHIVED":
      return { label: "Arquivado", tone: "neutral" };
    case "RENEWED":
      return { label: "Renovado", tone: "neutral" };
    case "DELETED":
      // Should never actually reach the UI (deleted items are excluded server-side), but an
      // exhaustive switch documents the real state space rather than silently coercing it.
      return { label: "Excluído", tone: "neutral" };
  }
}
