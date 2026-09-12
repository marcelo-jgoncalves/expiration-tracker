import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { Members } from "../../src/routes/Members.js";
import type { Member, Invitation } from "../../src/api/types.js";

const { getMock, postMock, putMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
  deleteMock: vi.fn(),
}));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, put: putMock, delete: deleteMock },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function member(overrides: Partial<Member>): Member {
  return { userId: "user-1", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", version: 1, ...overrides };
}

function invitation(overrides: Partial<Invitation>): Invitation {
  return { invitationId: "invitation-1", emailNormalized: "new@acme.com", role: "MEMBER", status: "PENDING", expiresAt: "2026-02-01T00:00:00.000Z", ...overrides };
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  putMock.mockReset();
  deleteMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("Members", () => {
  it("shows loading, then lists active members", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({})] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [] });
      throw new Error(`unexpected path ${path}`);
    });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "VIEWER", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    expect(screen.getByText("Carregando membros…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("user-1")).toBeInTheDocument());
  });

  // Mutação: trocar `canManageMembers` para incluir "VIEWER"/"MEMBER" (ou remover a checagem de
  // role) faria o formulário de convite e as ações de gerência aparecerem para um usuário que o
  // backend rejeitaria - a UI nunca deve prometer uma ação que o servidor vai recusar.
  it("hides invite form and management actions for a VIEWER (permission UX mirrors backend tier)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({})] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [] });
      throw new Error(`unexpected path ${path}`);
    });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "VIEWER", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    await waitFor(() => expect(screen.getByText("user-1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover" })).not.toBeInTheDocument();
  });

  it("shows invite form and management actions for an ADMIN", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({})] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [invitation({})] });
      throw new Error(`unexpected path ${path}`);
    });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    await waitFor(() => expect(screen.getByRole("button", { name: "Convidar" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument();
    expect(screen.getByText("new@acme.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revogar" })).toBeInTheDocument();
  });

  // A19 audit CRITICAL finding #3 (D-25x): membership:role-change is ADMIN_ROLES in the backend
  // matrix, but promoting/demoting the OWNER tier specifically requires an OWNER actor
  // (OwnerTierChangeRequiresOwnerError, authorization.ts comment on membership:role-change) - a
  // carve-out the generic authorize() matrix can't express and the frontend previously didn't
  // mirror at all, letting an ADMIN pick "Owner" in the dropdown for a guaranteed backend 403.
  it("lets an OWNER actor select the Owner role for another member", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({ userId: "user-2", role: "MEMBER" })] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [] });
      throw new Error(`unexpected path ${path}`);
    });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    const select = await screen.findByLabelText(new RegExp("^Papel de user-2"));
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain("OWNER");
  });

  it("hides the Owner option from an ADMIN actor's role dropdown", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({ userId: "user-2", role: "MEMBER" })] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [] });
      throw new Error(`unexpected path ${path}`);
    });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    const select = await screen.findByLabelText(new RegExp("^Papel de user-2"));
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).not.toContain("OWNER");
  });

  it("renders an existing OWNER's role as plain text (not editable) to a non-OWNER actor", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({ userId: "owner-1", role: "OWNER" })] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [] });
      throw new Error(`unexpected path ${path}`);
    });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    await waitFor(() => expect(screen.getByText("owner-1")).toBeInTheDocument());
    expect(screen.queryByLabelText(new RegExp("^Papel de owner-1"))).not.toBeInTheDocument();
    expect(screen.getByText("OWNER")).toBeInTheDocument();
  });

  it("submits the invite form with the entered email and default role", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [] });
      throw new Error(`unexpected path ${path}`);
    });
    postMock.mockResolvedValue({ invitation: { invitationId: "invitation-2" } });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    await waitFor(() => expect(screen.getByLabelText(/E-mail/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "convidado@acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/organizations/members/invite", { email: "convidado@acme.com", role: "MEMBER" }));
  });

  // Holistic frontend review finding: a failed invitations load used to render nothing at all,
  // indistinguishable from "no invitations pending" - an admin had no way to tell a real backend
  // failure apart from a genuinely empty list.
  it("shows a distinct error state (not silence) when pending invitations fail to load", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({})] });
      if (path === "/organizations/invitations") return Promise.reject(new Error("network down"));
      throw new Error(`unexpected path ${path}`);
    });
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    await waitFor(() => expect(screen.getByText("Não foi possível carregar os convites pendentes.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  // Holistic frontend review finding: a failed member removal had no error rendering at all -
  // the button just went back to its idle state with no feedback that nothing happened.
  it("shows a visible error when removing a member fails", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/members") return Promise.resolve({ members: [member({ userId: "user-2" })] });
      if (path === "/organizations/invitations") return Promise.resolve({ invitations: [] });
      throw new Error(`unexpected path ${path}`);
    });
    deleteMock.mockRejectedValue(new Error("Não foi possível remover este membro."));
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/members", <Members />, "/members");

    await waitFor(() => expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => expect(screen.getByText("Não foi possível remover este membro.")).toBeInTheDocument());
  });
});
