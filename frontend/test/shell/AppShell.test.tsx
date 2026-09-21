import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../../src/shell/AppShell.js";

const { useAuthMock, useCurrentMembershipRoleMock, useActiveOrganizationMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useCurrentMembershipRoleMock: vi.fn(),
  useActiveOrganizationMock: vi.fn(),
}));

vi.mock("../../src/auth/AuthContext.js", () => ({ useAuth: useAuthMock }));
vi.mock("../../src/hooks/useCurrentMembershipRole.js", () => ({ useCurrentMembershipRole: useCurrentMembershipRoleMock }));
// SidebarUserFooter's own concern (#15/sidebar identity card) - this suite verifies nav
// RBAC-filtering only, same rationale as the OrganizationSwitcher stub below.
vi.mock("../../src/auth/ActiveOrganizationContext.js", () => ({ useActiveOrganization: useActiveOrganizationMock }));
// OrganizationSwitcher pulls in TanStack Query + network-shaped hooks unrelated to what this
// suite verifies (nav RBAC-filtering) - stubbed out, same rationale as mocking apiClient in
// route tests that don't exercise the network layer themselves.
vi.mock("../../src/components/OrganizationSwitcher.js", () => ({ OrganizationSwitcher: () => null }));

function renderShell(initialEntry = "/app/org-1/overview") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/app/:orgId" element={<AppShell />}>
          <Route path="overview" element={<div>overview content</div>} />
          <Route path="items" element={<div>items content</div>} />
          <Route path="members" element={<div>members content</div>} />
          <Route path="settings" element={<div>settings content</div>} />
          <Route path="settings/document-types" element={<div>document types content</div>} />
          <Route path="settings/notifications" element={<div>notification preferences content</div>} />
          <Route path="activity" element={<div>activity content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ logout: vi.fn() });
  useCurrentMembershipRoleMock.mockReset();
  useActiveOrganizationMock.mockReset().mockReturnValue({ displayName: undefined, email: undefined });
});

describe("AppShell nav (D-2xx, Block 0 - declarative + RBAC-aware)", () => {
  it("shows every nav item while the role is still resolving (undefined)", () => {
    useCurrentMembershipRoleMock.mockReturnValue(undefined);
    renderShell();
    expect(screen.getByRole("link", { name: "Membros" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atividade" })).toBeInTheDocument();
  });

  it("shows Membros (roster is READ_ONLY_ROLES) but hides Atividade for a VIEWER", () => {
    useCurrentMembershipRoleMock.mockReturnValue("VIEWER");
    renderShell();
    expect(screen.getByRole("link", { name: "Membros" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Atividade" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visão geral" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vencimentos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fornecedores" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurações" })).toBeInTheDocument();
  });

  it("shows every item for an OWNER", () => {
    useCurrentMembershipRoleMock.mockReturnValue("OWNER");
    renderShell();
    expect(screen.getByRole("link", { name: "Membros" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atividade" })).toBeInTheDocument();
  });

  it("still renders the routed outlet content", () => {
    useCurrentMembershipRoleMock.mockReturnValue("OWNER");
    renderShell();
    expect(screen.getByText("overview content")).toBeInTheDocument();
  });

  it("builds every nav link org-scoped (/app/:orgId/...), never a bare path that would round-trip through LegacyOrgRedirect (Block 0 Codex review finding)", () => {
    useCurrentMembershipRoleMock.mockReturnValue("OWNER");
    renderShell();
    expect(screen.getByRole("link", { name: "Visão geral" })).toHaveAttribute("href", "/app/org-1/overview");
    expect(screen.getByRole("link", { name: "Vencimentos" })).toHaveAttribute("href", "/app/org-1/items");
    expect(screen.getByRole("link", { name: "Fornecedores" })).toHaveAttribute("href", "/app/org-1/subjects");
    expect(screen.getByRole("link", { name: "Membros" })).toHaveAttribute("href", "/app/org-1/members");
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/app/org-1/settings");
    expect(screen.getByRole("link", { name: "Atividade" })).toHaveAttribute("href", "/app/org-1/activity");
  });
});

describe("SidebarUserFooter (#15/sidebar identity card, 2026-09-21)", () => {
  it("shows the resolved displayName and role, and the initials avatar", () => {
    useCurrentMembershipRoleMock.mockReturnValue("ADMIN");
    useActiveOrganizationMock.mockReturnValue({ displayName: "Ana Exemplo", email: "ana@example.com" });
    renderShell();
    expect(screen.getByText("Ana Exemplo")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("AE")).toBeInTheDocument();
  });

  it("falls back to email when displayName is absent", () => {
    useCurrentMembershipRoleMock.mockReturnValue("MEMBER");
    useActiveOrganizationMock.mockReturnValue({ displayName: undefined, email: "ana@example.com" });
    renderShell();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
  });

  it("falls back to the role alone, never duplicated on both lines, when neither displayName nor email resolved", () => {
    useCurrentMembershipRoleMock.mockReturnValue("MEMBER");
    useActiveOrganizationMock.mockReturnValue({ displayName: undefined, email: undefined });
    renderShell();
    expect(screen.getAllByText("Member")).toHaveLength(1);
  });

  it("calls logout when the icon-only Sair button is clicked", () => {
    const logoutMock = vi.fn();
    useAuthMock.mockReturnValue({ logout: logoutMock });
    useCurrentMembershipRoleMock.mockReturnValue("OWNER");
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});

describe("AppShell nav highlighting (real bug, live `dev` 2026-09-14: Configurações stayed lit after navigating to unrelated screens)", () => {
  beforeEach(() => {
    useCurrentMembershipRoleMock.mockReturnValue("OWNER");
  });

  it("marks Configurações active while directly on /settings", () => {
    renderShell("/app/org-1/settings");
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute("aria-current", "page");
  });

  it("clears Configurações after navigating to a plain sibling (Vencimentos)", () => {
    renderShell("/app/org-1/settings");
    fireEvent.click(screen.getByRole("link", { name: "Vencimentos" }));
    expect(screen.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current");
  });

  it("clears Configurações after navigating to Membros", () => {
    renderShell("/app/org-1/settings");
    fireEvent.click(screen.getByRole("link", { name: "Membros" }));
    expect(screen.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current");
  });

  it("clears Configurações after navigating to Atividade (the transition that always worked)", () => {
    renderShell("/app/org-1/settings");
    fireEvent.click(screen.getByRole("link", { name: "Atividade" }));
    expect(screen.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current");
  });

  // The actual reported bug: these two routes are THEMSELVES separate nav items nested under
  // /settings/* (Tipos de documento / Notificações) - reachable directly
  // from the nav, never only via Configurações. Before the `end` fix, Configurações stayed
  // highlighted the whole time a user browsed between these "other menu items".
  it("does NOT mark Configurações active while on the nested /settings/document-types screen (its own nav item highlights instead)", () => {
    renderShell("/app/org-1/settings/document-types");
    expect(screen.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Tipos de documento" })).toHaveAttribute("aria-current", "page");
  });

  it("clears Configurações highlighting when moving directly between two nested /settings/* screens", () => {
    renderShell("/app/org-1/settings/document-types");
    fireEvent.click(screen.getByRole("link", { name: "Notificações" }));
    expect(screen.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Notificações" })).toHaveAttribute("aria-current", "page");
  });
});
