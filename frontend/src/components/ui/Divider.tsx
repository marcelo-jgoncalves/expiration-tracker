/**
 * Divider (design-system.md §29 catalog item) — a purely decorative separator between two
 * regions of content that are visually distinguishable without it (e.g. two sections that
 * already have their own spacing/heading). It is `aria-hidden` because it never carries
 * structural meaning on its own: a real boundary between content regions is a `<section>`
 * (see `Layout.tsx`'s `Section`), never a rule alone (mission §11 — never color/a bare line as
 * the only signal of a real structural break).
 *
 * Two orientations because both appear in the catalog: `horizontal` (default, full-width rule
 * inside a flow) and `vertical` (a rule between inline siblings, e.g. two Toolbar actions) —
 * `vertical` requires the parent to establish a height (flex/grid row) since a bare inline rule
 * has no intrinsic height.
 */
import "./Divider.css";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
}

export function Divider({ orientation = "horizontal" }: DividerProps) {
  return <div className={`ui-divider ui-divider--${orientation}`} aria-hidden="true" />;
}
