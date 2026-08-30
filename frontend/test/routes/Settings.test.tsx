import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { Settings } from "../../src/routes/Settings.js";
import { ApiError } from "../../src/api/errors.js";

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, request: patchMock, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

beforeEach(() => {
  getMock.mockReset();
  patchMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("Settings", () => {
  it("shows a read-only view for a non-OWNER", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
    expect(screen.getByText("Somente o Owner da organização pode alterar essas configurações.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nome da organização/)).not.toBeInTheDocument();
  });

  it("prefills the form with the current displayName for an OWNER, and submits an update with the real version", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 3 }] });
    patchMock.mockResolvedValue({ organizationId: "org-1", displayName: "Acme Corp", timezone: "America/Sao_Paulo", version: 4 });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByLabelText(/Nome da organização/)).toHaveValue("Acme"));
    fireEvent.change(screen.getByLabelText(/Nome da organização/), { target: { value: "Acme Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    // Mutação: usar um expectedVersion hardcoded (ex. 1) em vez do version real da organização
    // (3) faria esta asserção falhar - prova que Settings.tsx lê o version real, não um valor
    // fixo, fechando o bug que existia antes desta correção (activeOrganization.role usado como
    // condição sem sentido).
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("/organizations/settings", { method: "PATCH", body: { displayName: "Acme Corp" }, expectedVersion: 3 }));
    await waitFor(() => expect(screen.getByText("Configurações atualizadas.")).toBeInTheDocument());
  });

  it("shows a conflict-specific message on a stale expectedVersion (OCC)", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    patchMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "VERSION_CONFLICT", retryable: false }, 409));

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByLabelText(/Nome da organização/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(screen.getByText(/Alguém mais alterou a organização/)).toBeInTheDocument());
  });
});
