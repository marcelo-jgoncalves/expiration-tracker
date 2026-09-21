/**
 * IconButton (design-system.md §23/§29) — icon-only control for the small, extremely
 * conventional set of actions the catalog names as acceptable icon-only. Widened 2026-09-20
 * (Marcelo, achado na tela Fornecedores + pesquisa externa - Setproduct/SaaSUI/UX World's 2026
 * data-table guides all name "up to three action icons... with tooltips" as the standard
 * per-row pattern) from close/menu/back to also include the row-action icons whose glyph is
 * itself near-universally recognized without a caption: edit (pencil), delete (trash), archive/
 * unarchive. `title` (native tooltip on hover) + `aria-label` (accessible name for assistive
 * tech, works with or without a pointer) together satisfy the research's "icons with tooltips"
 * bar - `label` is REQUIRED (not optional) so the omission is impossible by construction, same
 * discipline as `TextField`'s label.
 *
 * Reuses `Button`'s visual variants/sizes rather than inventing a second control shape —
 * `design-system.md` §29 lists `IconButton` as a distinct catalog entry, but nothing about it
 * requires a different visual language, only a different content model (icon, not text) and a
 * square footprint. `IconButtonLink` is the `ButtonLink` equivalent, for a row action that
 * navigates (e.g. "Editar") rather than mutates in place.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import type { ButtonVariant, ButtonSize } from "./Button.js";
import "./Button.css";
import "./IconButton.css";

function classNames(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return ["ui-button", `ui-button--${variant}`, size === "sm" ? "ui-button--sm" : "", "ui-icon-button", extra ?? ""].filter(Boolean).join(" ");
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label"> {
  /** Accessible name. Required — this control has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function IconButton({ label, variant = "tertiary", size = "md", type = "button", children, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-label={label} title={label} className={classNames(variant, size)}>
      {children}
    </button>
  );
}

export interface IconButtonLinkProps extends Omit<LinkProps, "className" | "aria-label"> {
  /** Accessible name. Required — this control has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function IconButtonLink({ label, variant = "tertiary", size = "md", children, ...rest }: IconButtonLinkProps) {
  return (
    <Link {...rest} aria-label={label} title={label} className={classNames(variant, size, "ui-button--as-link")}>
      {children}
    </Link>
  );
}
