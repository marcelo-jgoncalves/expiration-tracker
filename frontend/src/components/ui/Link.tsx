/**
 * Link (design-system.md §29 catalog item) — the third half of the navigation trio alongside
 * `Button`/`ButtonLink` (mission §34): `Link` is for inline/textual navigation that must look
 * and read as a link, never as a button. Bare `<a>`/react-router `Link` already inherit the
 * correct visual treatment from `base.css` (colour, underline, hover, and the global
 * `:focus-visible` ring) — this component's actual job is the one thing that treatment does
 * NOT give for free: an external destination gets a visible, non-colour-only affordance
 * (mission §11) and the two attributes every external link needs for security
 * (`rel="noopener noreferrer"`, since `target="_blank"` alone leaves `window.opener` reachable
 * by the destination page).
 *
 * Internal navigation renders react-router's `Link` (client-side route change); external
 * navigation renders a real `<a>` — same split in kind as `Button` vs `ButtonLink`, so a
 * component never silently full-page-loads an internal route or client-side-routes an
 * external URL.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link as RouterLink, type LinkProps as RouterLinkProps } from "react-router-dom";
import "./Link.css";

export interface InternalLinkProps extends Omit<RouterLinkProps, "className"> {
  children: ReactNode;
}

export function Link({ children, ...rest }: InternalLinkProps) {
  return (
    <RouterLink {...rest} className="ui-link">
      {children}
    </RouterLink>
  );
}

export interface ExternalLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "target" | "rel"> {
  href: string;
  children: ReactNode;
}

export function ExternalLink({ href, children, ...rest }: ExternalLinkProps) {
  return (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer" className="ui-link ui-link--external">
      {children}
      {/* Visible marker text, not an icon glyph alone (mission §23 - icon-only needs a real
          accessible name; here the simplest correct fix is to just not be icon-only). */}
      <span className="ui-link__external-marker" aria-hidden="true">
        ↗
      </span>
      <span className="u-visually-hidden"> (abre em nova aba)</span>
    </a>
  );
}
