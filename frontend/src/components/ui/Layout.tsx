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
  children: ReactNode;
}

export function Section({ heading, headingId, annotation, description, children }: SectionProps) {
  return (
    <section className="ui-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="ui-section__heading">
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

export function Panel({ children, padded }: { children: ReactNode; padded?: boolean }) {
  return <div className={padded ? "ui-panel ui-panel--padded" : "ui-panel"}>{children}</div>;
}
