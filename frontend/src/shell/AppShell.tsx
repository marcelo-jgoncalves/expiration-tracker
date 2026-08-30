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
import { Button } from "../components/ui/Button.js";
import { OrganizationSwitcher } from "../components/OrganizationSwitcher.js";

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
          current-page treatment is tint + weight + an inset bar, never colour alone. */}
      <nav className="app-shell__nav" aria-label="Navegação principal">
        <span className="app-shell__wordmark">Expiration Tracker</span>
        <NavLink to="/overview" className={navLinkClassName}>
          Visão geral
        </NavLink>
        <NavLink to="/items" className={navLinkClassName}>
          Vencimentos
        </NavLink>
        <NavLink to="/subjects" className={navLinkClassName}>
          Fornecedores
        </NavLink>
        <NavLink to="/members" className={navLinkClassName}>
          Membros
        </NavLink>
        <NavLink to="/settings" className={navLinkClassName}>
          Configurações
        </NavLink>
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
