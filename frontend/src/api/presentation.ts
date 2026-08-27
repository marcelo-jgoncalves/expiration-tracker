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
import type { ExpirationItem, ExpirationItemStatus, DocumentSubmissionStatus, RequirementAssignmentStatus } from "./types.js";

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

/**
 * Urgency presentation for an ACTIVE item - the same vocabulary and threshold (0-7 days =
 * "vence em breve") already validated by the approved Interaction Prototype
 * (prototype/app.js's `itemStatusLabel`/`daysUntil`) and the density-stress ordering fix
 * (docs/frontend/interface-validation-readiness.md §12), carried into real code rather than
 * reinvented. Never called for a non-ACTIVE item - those have no urgency, only
 * `presentItemStatus`'s neutral lifecycle label applies (see `presentItemUrgency` below, which
 * dispatches correctly either way).
 *
 * Copy refinement over the prototype (mission §72, cosmetic not structural): day 0 reads
 * "Vence hoje" instead of the prototype's literal "VENCE EM 0 DIAS".
 */
export interface UrgencyPresentation extends StatusPresentation {
  /** Whole calendar days until dueDate (negative = overdue), computed against caller-supplied
   * `now` - date-only, ignoring time-of-day, so "today" is stable regardless of when in the
   * day the user loads the page. */
  daysUntil: number;
  group: "overdue" | "soon" | "later";
}

function dateOnlyUtc(iso: string): number {
  // First 10 chars ("YYYY-MM-DD") of an ISO date or date-time string - comparing calendar
  // dates directly avoids any timezone-conversion bug from parsing a UTC-stored dueDate
  // against a local-timezone `now` (a "vence hoje" that flips to "amanhã" depending on the
  // viewer's UTC offset would be a real correctness bug, not a cosmetic one).
  return Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysUntilDueDate(dueDate: string, now: Date): number {
  return Math.round((dateOnlyUtc(dueDate) - dateOnlyUtc(now.toISOString())) / MS_PER_DAY);
}

const SOON_THRESHOLD_DAYS = 7;

/**
 * Visual Language milestone refinement (mission §32/§87, meaning unchanged, clarity improved):
 * urgency and lifecycle status are now rendered as two adjacent columns/badges, which exposed
 * a real ambiguity in the previous labels - an ACTIVE item more than 7 days out was labelled
 * "Ativo" as its URGENCY, and a non-ACTIVE item repeated its own lifecycle label there. Side
 * by side that read as "Urgência: Ativo · Situação: Ativo", which says nothing and blurs
 * exactly the distinction mission §32 requires the system to keep. Both now say what they
 * actually mean: there is no urgency, or urgency does not apply to a closed cycle. No
 * threshold, grouping, ordering or tone changed - only the two labels.
 */
export function presentItemUrgency(item: Pick<ExpirationItem, "status" | "dueDate">, now: Date): UrgencyPresentation {
  if (item.status !== "ACTIVE") {
    return { label: "Não se aplica", tone: "neutral", daysUntil: daysUntilDueDate(item.dueDate, now), group: "later" };
  }
  const daysUntil = daysUntilDueDate(item.dueDate, now);
  if (daysUntil < 0) {
    return { label: "Vencido", tone: "danger", daysUntil, group: "overdue" };
  }
  if (daysUntil === 0) {
    return { label: "Vence hoje", tone: "warning", daysUntil, group: "soon" };
  }
  if (daysUntil <= SOON_THRESHOLD_DAYS) {
    return { label: daysUntil === 1 ? "Vence em 1 dia" : `Vence em ${daysUntil} dias`, tone: "warning", daysUntil, group: "soon" };
  }
  return { label: "Sem urgência", tone: "neutral", daysUntil, group: "later" };
}

/** DD/MM/YYYY - matches mission §20's example format exactly. Formats the date portion only
 * (never shifted by the viewer's local timezone - see `dateOnlyUtc` above for why that matters). */
export function formatAbsoluteDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

/** Just the relative half - "Vence em 6 dias", "Venceu há 1 dia", "Vence hoje".
 *
 * Extracted (Visual Language milestone) because a table shows the absolute date and its
 * relative context in two separate lines of the same cell, and reconstructing that by
 * string-splitting `formatRelativeDueDate`'s " · " separator would make a display detail
 * load-bearing. The absolute date is never replaced by this value - both are always shown
 * together (mission §19). */
export function formatRelativeDueContext(dueDate: string, now: Date): string {
  const daysUntil = daysUntilDueDate(dueDate, now);
  if (daysUntil < 0) {
    const overdueDays = Math.abs(daysUntil);
    return `Venceu ${overdueDays === 1 ? "há 1 dia" : `há ${overdueDays} dias`}`;
  }
  if (daysUntil === 0) {
    return "Vence hoje";
  }
  return `Vence em ${daysUntil === 1 ? "1 dia" : `${daysUntil} dias`}`;
}

/** "30/08/2026 · Vence em 6 dias" - absolute date always paired with relative temporal context
 * (mission §20: never rely on "Em breve" alone). */
export function formatRelativeDueDate(dueDate: string, now: Date): string {
  return `${formatAbsoluteDate(dueDate)} · ${formatRelativeDueContext(dueDate, now)}`;
}

/** Most-urgent-first (mission §19/§72): plain ascending due-date sort already produces this -
 * an overdue item's date is earlier than a not-yet-due item's, and among overdue items the
 * MOST overdue (earliest date) sorts first automatically. Shared by Overview and the
 * Expiration Collection (extracted here, mission §59 - real reuse across two call sites)
 * rather than duplicated. */
export function sortByDueDateAscending<T extends Pick<ExpirationItem, "dueDate">>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * BLOCKER-C review queue labels. Same Epistemic Integrity discipline the interface planning
 * docs established (interface-conceptual-model-and-information-architecture.md §44) and this
 * file's own header comment restates: never a claim stronger than the domain actually
 * supports. `SATISFIED` is a link recorded once, never revalidated against the linked item's
 * own current status - it means "vinculado", never "em dia"/"válido" (that would require
 * live recomputation this domain doesn't do). `CLEAN` on a submission means only that the
 * malware scan passed, never that a human confirmed the document's content is correct.
 */
export function presentRequirementStatus(status: RequirementAssignmentStatus): StatusPresentation {
  switch (status) {
    case "MISSING":
      return { label: "Faltando", tone: "warning" };
    case "REQUESTED":
      return { label: "Solicitado", tone: "neutral" };
    case "SUBMITTED":
      return { label: "Enviado, aguardando revisão", tone: "warning" };
    case "UNDER_REVIEW":
      return { label: "Em análise", tone: "neutral" };
    case "REJECTED":
      return { label: "Rejeitado", tone: "danger" };
    case "SATISFIED":
      return { label: "Vinculado a um vencimento", tone: "neutral" };
  }
}

export function presentSubmissionStatus(status: DocumentSubmissionStatus): StatusPresentation {
  switch (status) {
    case "PENDING_UPLOAD":
      return { label: "Aguardando envio", tone: "neutral" };
    case "SCANNING":
      return { label: "Verificando segurança", tone: "neutral" };
    case "CLEAN":
      return { label: "Verificado (segurança) — conteúdo não conferido", tone: "neutral" };
    case "REJECTED":
      return { label: "Rejeitado (ameaça detectada)", tone: "danger" };
    case "UNSUPPORTED":
      return { label: "Arquivo não suportado", tone: "danger" };
    case "TIMEOUT":
      return { label: "Envio expirado", tone: "warning" };
    case "DELETED":
      return { label: "Excluído", tone: "neutral" };
  }
}
