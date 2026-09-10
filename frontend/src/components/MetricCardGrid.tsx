/**
 * SLF-01 remediation (D-2xx, Block 0 - docs/architecture/reviews/screen-spec-audit-2026-09-09/
 * system-level-findings.md). The audit confirmed, on two independent screens (A03 Dashboard, A09
 * Subject Hub), that a flat grid of visually-identical metric-link cards caps a screen's rubric
 * score at 8/17 on V7 (product-specific authorship) - a "4 equal cards" layout gives overdue,
 * critical counters the SAME visual weight as routine ones, encoding no comparative risk through
 * composition, only through badge tone (which a user scanning quickly never gets to). SLF-01's
 * remediation owner is "the design-system/pattern-library maintainer" defining this as a real
 * shared component - this is that component, generalized from A03's revised spec
 * (`prototype-screen-specs/A03-dashboard.md`) rather than copied from one screen.
 *
 * Risk-prioritized, concretely: at most ONE card in a grid is `critical` at a time (never more -
 * a grid where every card claims to be the most urgent one is not risk-prioritized, it is just
 * loud) - that card alone gets a colored `status.critical` surface AND a larger counter typeface
 * (`--font-size-900`/`--line-height-900`, "Display") than the other cards' standard counter
 * (`--font-size-800`/`--line-height-800`, "Page Title"). Every other card keeps the plain default
 * surface. This is composition-level hierarchy, not just a tinted number - exactly what the audit
 * found missing.
 *
 * Each card is independently async (SPEC GAP the same audit found alongside SLF-01: A03's
 * original spec had no per-counter loading/failure semantics) - one card's failure never blocks
 * or blanks the others, and a `loading` card reserves the SAME footprint its resolved state will
 * use (no layout shift once data lands).
 */
import type { ReactNode } from "react";
import { useId } from "react";
import { Link } from "react-router-dom";
import { Button } from "./ui/Button.js";
import "./MetricCardGrid.css";

export type MetricCardStatus = { kind: "loading" } | { kind: "error"; message: string; onRetry: () => void } | { kind: "value"; value: ReactNode };

export interface MetricCardData {
  /** Stable id, used as the React key - independent of `label` so a copy change never silently
   * changes card identity across renders. */
  id: string;
  label: string;
  to: string;
  /** Read via `aria-describedby` - states the link's destination in full for a screen-reader
   * user, since the visible card only shows a bare count + short label (mission-established
   * pattern: `A03-dashboard.md`'s own `sr-only` destination description). */
  srDescription: string;
  status: MetricCardStatus;
  /** At most one card per grid should be `true` - see this file's header comment. Never a
   * decorative choice; it must reflect real domain severity (e.g. `overdue > 0`), decided by the
   * caller, never by this component (it has no domain knowledge to make that call itself). */
  critical?: boolean;
}

function MetricCardSkeleton({ label }: { label: string }) {
  return (
    <div className="ui-metric-card ui-metric-card--loading" aria-hidden="true">
      <span className="ui-metric-card__skeleton-bar" />
      <span className="ui-metric-card__label">{label}</span>
    </div>
  );
}

function MetricCardError({ label, message, onRetry }: { label: string; message: string; onRetry: () => void }) {
  return (
    <div className="ui-metric-card ui-metric-card--error" role="alert">
      <p className="ui-metric-card__error-message">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
      <span className="ui-metric-card__label">{label}</span>
    </div>
  );
}

function MetricCardLink({ card }: { card: MetricCardData & { status: { kind: "value" } } }) {
  const descriptionId = useId();
  return (
    <Link to={card.to} className={`ui-metric-card ui-metric-card--link${card.critical ? " ui-metric-card--critical" : ""}`} aria-describedby={descriptionId}>
      <span className={`ui-metric-card__count${card.critical ? " ui-metric-card__count--critical" : ""}`}>{card.status.value}</span>
      <span className="ui-metric-card__label">{card.label}</span>
      <span className="u-visually-hidden" id={descriptionId}>
        {card.srDescription}
      </span>
    </Link>
  );
}

/**
 * Enforces "at most one critical card" structurally (Block 0 Codex review round: the first draft
 * only documented this invariant, never enforced it - a caller passing 2+ `critical: true` cards
 * would silently render 2+ equally-loud cards, exactly the "every card claims to be the most
 * urgent one" failure mode this component exists to prevent). Only the FIRST `critical: true`
 * card (array order - the caller's own ordering choice) keeps it; every later one is demoted to
 * standard weight. A `console.error` surfaces the caller bug immediately rather than letting a
 * wrong severity call ship silently - this is a real domain-severity contract, not a cosmetic
 * default (no build-time env gate here - a wrong `critical` call is a real bug in any
 * environment, and this codebase has no `vite-env.d.ts` declaring `import.meta.env` yet). */
function withAtMostOneCritical(cards: MetricCardData[]): MetricCardData[] {
  let seenCritical = false;
  return cards.map((card) => {
    if (!card.critical) return card;
    if (seenCritical) {
      // eslint-disable-next-line no-console
      console.error(`MetricCardGrid: more than one card marked critical=true (offending id: "${card.id}") - only the first is honored. Fix the caller.`);
      return { ...card, critical: false };
    }
    seenCritical = true;
    return card;
  });
}

export function MetricCardGrid({ cards }: { cards: MetricCardData[] }) {
  const normalizedCards = withAtMostOneCritical(cards);
  return (
    <div className="ui-metric-card-grid">
      {normalizedCards.map((card) => {
        switch (card.status.kind) {
          case "loading":
            return <MetricCardSkeleton key={card.id} label={card.label} />;
          case "error":
            return <MetricCardError key={card.id} label={card.label} message={card.status.message} onRetry={card.status.onRetry} />;
          case "value":
            return <MetricCardLink key={card.id} card={card as MetricCardData & { status: { kind: "value" } }} />;
        }
      })}
    </div>
  );
}
