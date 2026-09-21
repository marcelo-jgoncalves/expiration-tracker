/**
 * Structural layout primitives (mission §61). Deliberately dumb and small: they own spacing
 * and heading hierarchy so that no route file re-invents "what a page title looks like", and
 * they own nothing else.
 *
 * `Panel` is the system's ONLY grouping container. There is no `Card` component, on purpose
 * (mission §30, course correction: cards must stay light and must not multiply) — a card is
 * what you reach for when independent modules genuinely need separating, and the Core
 * Expiration slice has no such grouping yet.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import "./Layout.css";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Rendered above the title — a back link, breadcrumb, or similar. */
  above?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, above, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__text">
        {above ? <div className="ui-page-header__back">{above}</div> : null}
        <h1>{title}</h1>
        {description ? <p className="ui-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export interface SectionProps {
  /** Rendered as an <h2> and wired to the <section> via aria-labelledby. */
  heading: string;
  headingId: string;
  /** Small supporting count/annotation shown next to the heading. */
  annotation?: ReactNode;
  description?: ReactNode;
  /** Decorative accent icon next to the heading (Marcelo, 2026-09-20, tela Detalhe do
   * Vencimento) - purely visual, `aria-hidden`: the heading text alone already carries the
   * meaning, same discipline as every other icon+text pairing in this design system. */
  icon?: LucideIcon;
  children: ReactNode;
}

export function Section({ heading, headingId, annotation, description, icon: Icon, children }: SectionProps) {
  return (
    <section className="ui-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-section__heading">
        {Icon ? <Icon size={17} strokeWidth={2} aria-hidden="true" className="ui-section__icon" /> : null}
        {heading}
        {annotation ? <> {annotation}</> : null}
      </h2>
      {description ? <p className="ui-section__description">{description}</p> : null}
      {children}
    </section>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="ui-toolbar">{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="ui-toolbar__spacer" />;
}

export interface StatusFilterOption<T extends string> {
  value: T;
  label: string;
}

/** Shared segmented status toggle (extracted from ItemsCollection.tsx during the Fornecedores
 * pass, which had drifted to a `<Button aria-current="page">` row instead). Real `<button>`s
 * grouped by `role="group"`, driven by `aria-pressed` — never `aria-current` (these select which
 * lifecycle-status subset of the SAME collection is shown, not a page) and never an ARIA tablist
 * (which would promise a tabpanel/keyboard model that does not exist here). */
export function StatusFilter<T extends string>({ options, value, onChange }: { options: readonly StatusFilterOption<T>[]; value: T; onChange: (next: T) => void }) {
  return (
    <div className="ui-filter" role="group" aria-label="Filtrar por status">
      {options.map((option) => (
        <button key={option.value} type="button" className="ui-filter__option" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ children, padded }: { children: ReactNode; padded?: boolean }) {
  return <div className={padded ? "ui-panel ui-panel--padded" : "ui-panel"}>{children}</div>;
}

export interface AttentionItem {
  count: number;
  label: string;
  /** `critical`/`warning` use the same status colour pair as `StatusBadge`; `accent` uses the
   * product's own brand colour (the "total in progress" card is not a warning/error, so it
   * never borrows status red/amber). Never a decorative tile (mission §29's "KPI theater", D-08
   * of visual-language-and-design-system.md) - every item is a real link `to` the filtered
   * group it counts, never a bare number. */
  tone: "critical" | "warning" | "accent";
  icon: LucideIcon;
  to: string;
}

export interface SummaryHeroField {
  label: string;
  /** Omit (or leave `undefined`) to skip the field entirely, same discipline as
   * `ItemDetail.tsx`'s `DetailList` - a hero slot never renders with nothing to show. */
  value: ReactNode | undefined;
  /** Small supporting line under `value` (e.g. a relative date next to the absolute one). */
  helper?: ReactNode;
}

/** Headline summary band (Marcelo, 2026-09-20, achado na tela Detalhe do Vencimento) — NOT a
 * second `Panel`/Card (see this file's header comment): it never groups independent modules,
 * it restates the record's own 3-4 most-glanced-at fields in one emphasized band. Exists
 * exactly once per page and only makes sense paired with a caller that removes those same
 * fields from whatever list/table sits below it - a hero repeating a value a panel already
 * shows a few lines down is decoration, not emphasis. */
export function SummaryHero({ fields }: { fields: readonly SummaryHeroField[] }) {
  const present = fields.filter((field): field is SummaryHeroField & { value: ReactNode } => field.value !== undefined);
  if (present.length === 0) return null;
  return (
    <div className="ui-hero">
      {present.map((field) => (
        <div key={field.label} className="ui-hero__field">
          <span className="ui-hero__label">{field.label}</span>
          <span className="ui-hero__value">{field.value}</span>
          {field.helper ? <span className="ui-hero__helper">{field.helper}</span> : null}
        </div>
      ))}
    </div>
  );
}

export function AttentionRow({ items }: { items: readonly AttentionItem[] }) {
  return (
    <ul className="ui-attention">
      {items.map((item) => (
        <li key={item.label} className="ui-attention__item">
          <Link to={item.to} className="ui-attention__link">
            <span className={`ui-attention__icon ui-attention__icon--${item.tone}`}>
              <item.icon size={21} strokeWidth={2} aria-hidden="true" />
            </span>
            <span>
              <span className="ui-attention__count">{item.count}</span>
              <span className="ui-attention__label">{item.label}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
