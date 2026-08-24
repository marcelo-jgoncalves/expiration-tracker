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
import type { ExpirationItem, ExpirationItemStatus } from "./types.js";

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

export function presentItemUrgency(item: Pick<ExpirationItem, "status" | "dueDate">, now: Date): UrgencyPresentation {
  if (item.status !== "ACTIVE") {
    return { ...presentItemStatus(item.status), daysUntil: daysUntilDueDate(item.dueDate, now), group: "later" };
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
  return { label: "Ativo", tone: "neutral", daysUntil, group: "later" };
}

/** DD/MM/YYYY - matches mission §20's example format exactly. Formats the date portion only
 * (never shifted by the viewer's local timezone - see `dateOnlyUtc` above for why that matters). */
export function formatAbsoluteDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

/** "30/08/2026 · Vence em 6 dias" - absolute date always paired with relative temporal context
 * (mission §20: never rely on "Em breve" alone). */
export function formatRelativeDueDate(dueDate: string, now: Date): string {
  const daysUntil = daysUntilDueDate(dueDate, now);
  const absolute = formatAbsoluteDate(dueDate);
  if (daysUntil < 0) {
    const overdueDays = Math.abs(daysUntil);
    return `${absolute} · Venceu ${overdueDays === 1 ? "há 1 dia" : `há ${overdueDays} dias`}`;
  }
  if (daysUntil === 0) {
    return `${absolute} · Vence hoje`;
  }
  return `${absolute} · Vence em ${daysUntil === 1 ? "1 dia" : `${daysUntil} dias`}`;
}

/** Most-urgent-first (mission §19/§72): plain ascending due-date sort already produces this -
 * an overdue item's date is earlier than a not-yet-due item's, and among overdue items the
 * MOST overdue (earliest date) sorts first automatically. Shared by Overview and the
 * Expiration Collection (extracted here, mission §59 - real reuse across two call sites)
 * rather than duplicated. */
export function sortByDueDateAscending<T extends Pick<ExpirationItem, "dueDate">>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}
