/**
 * Structural production shell (mission §24-26) - NOT a visual design. Landmark regions only:
 * navigation container, main content region, global error region, session boundary. Final
 * sidebar/header design, spacing, colors, and navigation styling are explicitly deferred to
 * Visual Language + High-Fidelity UI after User Validation (mission §25/§80-82) - this shell
 * must survive that work unchanged in structure, not be thrown away.
 *
 * Navigation mirrors the approved dual-anchor IA (docs/frontend/interface-conceptual-model-
 * and-information-architecture.md: Vencimentos + Fornecedor/Subject as two coexisting mental
 * anchors, no single hierarchy) - the same structural nav convention already established in
 * prototype/app.js's structuralNav(), carried into real routing rather than reinvented.
 */
import { useEffect, useRef, type RefObject } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { useAuth } from "../auth/AuthContext.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { useOrgPath } from "../routing/useOrgPath.js";
import { Button } from "../components/ui/Button.js";
import { OrganizationSwitcher } from "../components/OrganizationSwitcher.js";
import { getVisibleNavItems } from "./navigation.js";

function navLinkClassName(): string {
  return "app-shell__link";
}

/**
 * Focus management on route transitions (mission §56) - client-side navigation never resets
 * focus the way a real page load would, so without this, a screen reader user who follows a
 * link (Collection -> Detail -> Renew, etc.) gets no announcement that the page changed at
 * all. Moves focus to the `#surface-content` landmark (already `tabIndex={-1}` for exactly
 * this purpose) on every pathname change AFTER the first render - skipping the initial mount
 * so it never steals focus from the skip-link a keyboard user may have just activated.
 */
function useFocusMainOnRouteChange(mainRef: RefObject<HTMLElement>) {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname, mainRef]);
}

export function AppShell() {
  const { logout } = useAuth();
  const role = useCurrentMembershipRole();
  const visibleNavItems = getVisibleNavItems(role);
  const orgPath = useOrgPath();
  const mainRef = useRef<HTMLElement>(null);
  useFocusMainOnRouteChange(mainRef);

  return (
    <div className="app-shell">
      <a href="#surface-content" className="skip-link">
        Pular para o conteúdo
      </a>
      {/* A plain vertical list of links on desktop, a wrapping row when narrow (CSS only) -
          visually simple, stable and predictable, so it orients without competing with the
          operational content. `NavLink` supplies aria-current="page" itself; the visual
          current-page treatment is tint + weight + an inset bar, never colour alone.
          Declarative + RBAC-aware (D-2xx, Block 0, navigation.ts): the list itself is data, and
          an item the current role cannot act on at all is omitted here, never rendered-disabled
          (p0-screen-inventory-plan.md §2.1). `item.to` is org-relative (`/overview`, not
          `/app/:orgId/overview`) - resolved through `useOrgPath()` here, the same helper every
          screen's internal links use, so clicking the nav itself never round-trips through
          `LegacyOrgRedirect` (found in the Block 0 Codex review round: the first draft left
          these bare, which silently remounted AppShell - and the focus-management fix above -
          on every single nav click). */}
      <nav className="app-shell__nav" aria-label="Navegação principal">
        <span className="app-shell__wordmark">Expiration Tracker</span>
        {visibleNavItems.map((item) => (
          <NavLink key={item.id} to={orgPath(item.to)} className={navLinkClassName}>
            {item.label}
          </NavLink>
        ))}
        <span className="app-shell__nav-spacer" />
        <OrganizationSwitcher />
        <Button variant="tertiary" size="sm" onClick={() => void logout()}>
          Sair
        </Button>
      </nav>
      <main className="app-shell__main" id="surface-content" tabIndex={-1} ref={mainRef}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
