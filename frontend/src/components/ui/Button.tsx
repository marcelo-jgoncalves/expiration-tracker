/**
 * Button (mission §33/§34/§62).
 *
 * Two components, deliberately, because the semantic distinction is the point (mission §34):
 * `Button` renders a real `<button>` for mutations/actions, `ButtonLink` renders a real
 * react-router `<Link>` for navigation that merely LOOKS like a button. Neither is ever a
 * styled `<div>`. The visual variant is a prop describing INTENT (`primary`/`danger`), never
 * an appearance (`isBlue`) — mission §62.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import "./Button.css";

// "ghost" (A20/A21, Block 4, D-2xx) - the canonical 4th variant name per design-system.md §30
// ("primary/secondary/ghost/danger") - additive alongside the pre-existing "tertiary" (never
// renamed here: that would touch every existing call site for a naming nit, out of this
// block's scope). Same low-emphasis/never-destructive semantics as tertiary, reused visually
// (Button.css) - the two audited specs (A20/A21) both name "ghost" explicitly for reversible,
// non-destructive row actions (Descontinuar/Reativar, Arquivar/Reativar), never "tertiary".
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

function classNames(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return ["ui-button", `ui-button--${variant}`, size === "sm" ? "ui-button--sm" : "", extra ?? ""].filter(Boolean).join(" ");
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** In-flight mutation. Renders the control inert AND expects the caller to swap the label,
   * so "why is this disabled?" is always answerable from the visible text alone. */
  pending?: boolean;
  children: ReactNode;
}

export function Button({ variant = "secondary", size = "md", pending, disabled, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classNames(variant, size)}
      // `disabled || pending`, never `disabled ?? pending` (Codex Round B, B-01): RenewItem
      // passes `disabled={conflict}`, which is `false` - not `undefined` - during a normal
      // renewal, so `??` short-circuited on the explicit `false` and left an in-flight submit
      // button live while it visibly read "Renovando…".
      disabled={Boolean(disabled || pending)}
      data-pending={pending ? "true" : undefined}
      aria-busy={pending ? true : undefined}
    >
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends Omit<LinkProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function ButtonLink({ variant = "secondary", size = "md", children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={classNames(variant, size, "ui-button--as-link")}>
      {children}
    </Link>
  );
}
