/**
 * IconButton (design-system.md §23/§29) — icon-only control for the small, extremely
 * conventional set of actions the catalog names as acceptable icon-only (close, menu, back).
 * `label` is REQUIRED (not optional): an icon-only control with no accessible name is
 * unusable by assistive tech, so the type signature makes the omission impossible rather than
 * relying on every call site remembering `aria-label` (mission §23's "icon-only precisa de
 * nome acessível" is enforced by construction, same discipline as `TextField`'s label).
 *
 * Reuses `Button`'s visual variants/sizes rather than inventing a second control shape —
 * `design-system.md` §29 lists `IconButton` as a distinct catalog entry, but nothing about it
 * requires a different visual language, only a different content model (icon, not text) and a
 * square footprint.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { ButtonVariant, ButtonSize } from "./Button.js";
import "./Button.css";
import "./IconButton.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label"> {
  /** Accessible name. Required — this control has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function IconButton({ label, variant = "tertiary", size = "md", type = "button", children, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={["ui-button", `ui-button--${variant}`, size === "sm" ? "ui-button--sm" : "", "ui-icon-button"].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}
