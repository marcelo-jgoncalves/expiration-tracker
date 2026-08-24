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
import { NavLink, Outlet } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { useAuth } from "../auth/AuthContext.js";

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "nav-current" : "";
}

export function AppShell() {
  const { logout } = useAuth();

  return (
    <div>
      <a href="#surface-content" className="skip-link">
        Pular para o conteúdo
      </a>
      <nav aria-label="Navegação principal">
        <NavLink to="/overview" className={navLinkClassName}>
          Overview
        </NavLink>{" "}
        <NavLink to="/items" className={navLinkClassName}>
          Vencimentos
        </NavLink>{" "}
        <NavLink to="/subjects" className={navLinkClassName}>
          Fornecedores
        </NavLink>{" "}
        <NavLink to="/settings" className={navLinkClassName}>
          Configurações
        </NavLink>{" "}
        <button type="button" onClick={() => void logout()}>
          Sair
        </button>
      </nav>
      <main id="surface-content" tabIndex={-1}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
