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
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { useAuth } from "../auth/AuthContext.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { useOrgPath } from "../routing/useOrgPath.js";
import { OrganizationSwitcher } from "../components/OrganizationSwitcher.js";
import { initialsFor, presentMembershipRole } from "../api/presentation.js";
import { LogOut, Menu, X } from "lucide-react";
import { Dialog } from "../components/ui/Dialog.js";
import "./OmniShell.css";
import { getVisibleNavItems } from "./navigation.js";

/** Sidebar identity card + logout (Marcelo, 2026-09-21, matches `prototype/03 - Fornecedor
 * Detalhe.html`'s `.v2-rail-footer`) - avatar-with-initials + name/role text + an icon-only
 * logout button, pinned to the bottom of the rail by the existing `app-shell__nav-spacer`
 * above it. `displayName`/`email` come from `ActiveOrganizationContext` (#15, resolved from
 * the logged-in user's own GlobalUser) - absent means "no name/email on file", falls back to
 * the role alone rather than showing nothing. */
function SidebarUserFooter() {
  const { logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState(false);
  const { displayName, email } = useActiveOrganization();
  const role = useCurrentMembershipRole();
  const roleLabel = role ? presentMembershipRole(role) : undefined;
  // A resolved name/email is the primary line, with role as a secondary line underneath - but
  // when neither resolved, role becomes the primary line itself (never duplicated on both lines).
  const primary = displayName || email || roleLabel || "Minha conta";
  const secondary = (displayName || email) && roleLabel ? roleLabel : undefined;
  const initials = initialsFor(displayName) || (email ? email[0]!.toUpperCase() : "");

  return (
    <div className="app-shell__footer">
      {initials ? (
        <span className="app-shell__avatar" aria-hidden="true">
          {initials}
        </span>
      ) : null}
      <span className="app-shell__footer-text">
        <span className="app-shell__footer-name" title={primary}>{primary}</span>
        {secondary ? <span className="app-shell__footer-role">{secondary}</span> : null}
      </span>
      <button type="button" className="app-shell__icon-button" aria-label="Sair" disabled={leaving} onClick={() => { setLeaving(true); setFailure(false); void logout().catch(() => setFailure(true)).finally(() => setLeaving(false)); }}>
        <LogOut size={17} strokeWidth={2} aria-hidden="true" />
      </button>
      {failure && <p role="alert">Não foi possível sair. Tente novamente.</p>}
    </div>
  );
}

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
    // D-339 achado real: dar rota própria a um Dialog (ex.: RequirementDetail,
    // `/subjects/:subjectId/requirements/:requirementId`) faz seu mount coincidir, no MESMO
    // commit React, com esta troca de `location.pathname` - efeitos rodam de baixo para cima
    // (filho antes do pai), então o próprio foco inicial do Dialog (`Dialog.tsx`, no primeiro
    // elemento focável do painel) roda primeiro, e ESTE efeito, um ancestral, rodava depois e
    // devolvia o foco para `<main>`, sequestrando-o de volta - nunca reproduzido antes porque
    // nenhum Dialog neste app tinha rota própria até agora. Nunca sequestrar foco que já está
    // dentro de um dialog real (ex.: a própria navegação que abriu ESSE dialog) - meio termo
    // seguro: perguntar ao DOM se o foco atual já está dentro de um `[role=dialog]`/
    // `[role=alertdialog]`, não uma lista fixa de rotas.
    if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) return;
    mainRef.current?.focus();
  }, [location.pathname, mainRef]);
}

export function AppShell() {
  const role = useCurrentMembershipRole();
  const visibleNavItems = getVisibleNavItems(role);
  const orgPath = useOrgPath();
  const mainRef = useRef<HTMLElement>(null);
  useFocusMainOnRouteChange(mainRef);

  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  // useLayoutEffect (not useEffect) - the "Abrir menu" button that opens this dialog lives
  // INSIDE `main`, and `Dialog.tsx` restores focus to it from its own (passive) unmount effect.
  // An inert element's descendants are unfocusable, so `main`'s `inert` attribute MUST already
  // be gone before that focus-restore runs, or it silently no-ops and focus is lost to the
  // document body. Layout effect cleanups run synchronously at commit, before any passive
  // effect (Dialog's included) fires - ordering this one first, deterministically, rather than
  // relying on incidental effect-scheduling order between two unrelated components.
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const main = mainRef.current;
    main?.setAttribute("inert", "");
    return () => {
      document.body.style.overflow = oldOverflow;
      main?.removeAttribute("inert");
    };
  }, [menuOpen]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 901px)");
    const close = () => { if (media.matches) setMenuOpen(false); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);

  const groups = [
    { label: "Espaço de trabalho", ids: ["overview", "items", "subjects", "requirements", "reviews"] },
    { label: "Gestão", ids: ["imports", "document-types", "requirement-templates", "request-delivery", "activity", "reports"] },
    { label: "Organização", ids: ["members", "notification-preferences", "settings"] },
  ];
  function navigation(mobile = false) {
    return <nav className="app-shell__nav" id={mobile ? "mobile-navigation" : undefined} aria-label="Navegação principal">
      <NavLink to={orgPath("/overview")} className="app-shell__wordmark"><img src="/brand/omnivence.png" alt="OmniVence — Gestão inteligente de vencimentos" /></NavLink>
      {mobile && <button className="app-shell__close" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}><X aria-hidden="true" /></button>}
      {groups.map(group => <div className="app-shell__group" key={group.label}>
        <p className="app-shell__group-label">{group.label}</p>
        {visibleNavItems.filter(item => group.ids.includes(item.id)).map(item =>
          <NavLink key={item.id} to={orgPath(item.to)} end={item.end} className={navLinkClassName}>
            <item.icon size={17} strokeWidth={2} aria-hidden="true" />{item.label}
          </NavLink>)}
      </div>)}
      <span className="app-shell__nav-spacer" />
      <OrganizationSwitcher />
      <SidebarUserFooter />
    </nav>;
  }

  return <div className="app-shell ov-shell">
    <a href="#surface-content" className="skip-link">Pular para o conteúdo</a>
    <div className="app-shell__desktop-nav">{navigation()}</div>
    <main className="app-shell__main" id="surface-content" tabIndex={-1} ref={mainRef}>
      <button className="app-shell__menu" aria-label="Abrir menu" aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(true)}><Menu aria-hidden="true" /></button>
      <ErrorBoundary><Outlet /></ErrorBoundary>
    </main>
    {menuOpen && <div className="app-shell__mobile-nav"><Dialog title="Menu" onClose={() => setMenuOpen(false)}>{navigation(true)}</Dialog></div>}
  </div>;
}
