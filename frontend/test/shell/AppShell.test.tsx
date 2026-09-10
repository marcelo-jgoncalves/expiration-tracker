import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../../src/shell/AppShell.js";

const { useAuthMock, useCurrentMembershipRoleMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useCurrentMembershipRoleMock: vi.fn(),
}));

vi.mock("../../src/auth/AuthContext.js", () => ({ useAuth: useAuthMock }));
vi.mock("../../src/hooks/useCurrentMembershipRole.js", () => ({ useCurrentMembershipRole: useCurrentMembershipRoleMock }));
// OrganizationSwitcher pulls in TanStack Query + network-shaped hooks unrelated to what this
// suite verifies (nav RBAC-filtering) - stubbed out, same rationale as mocking apiClient in
// route tests that don't exercise the network layer themselves.
vi.mock("../../src/components/OrganizationSwitcher.js", () => ({ OrganizationSwitcher: () => null }));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/app/org-1/overview"]}>
      <Routes>
        <Route path="/app/:orgId" element={<AppShell />}>
          <Route path="overview" element={<div>overview content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthMock.mockReset().mockReturnValue({ logout: vi.fn() });
  useCurrentMembershipRoleMock.mockReset();
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
