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
});
