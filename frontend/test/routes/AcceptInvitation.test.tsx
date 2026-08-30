import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { AcceptInvitation } from "../../src/routes/AcceptInvitation.js";
import { ApiError } from "../../src/api/errors.js";

const { acceptInvitationMock, navigateMock } = vi.hoisted(() => ({ acceptInvitationMock: vi.fn(), navigateMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  acceptInvitation: acceptInvitationMock,
  fetchOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  selectOrganization: vi.fn(),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

beforeEach(() => {
  acceptInvitationMock.mockReset();
  navigateMock.mockReset();
});

describe("AcceptInvitation", () => {
  // Wave B2B-14 (D-120): handleAcceptInvitation has existed since B2B-8, but no frontend route
  // ever called it - the invite flow could never be completed by anyone until this page existed.
  it("shows an error and never calls the API when the URL has no token", () => {
    renderAtRoute("/accept-invitation", <AcceptInvitation />, "/accept-invitation");

    expect(screen.getByText(/Link de convite inválido/)).toBeInTheDocument();
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });

  // Mutação: chamar accept.mutate() sem o token real (ex. hardcoded) faria esta asserção
  // falhar - prova que o token vem de fato da query string, não de um valor fixo.
  it("fires acceptInvitation with the token from the query string on mount", async () => {
    acceptInvitationMock.mockResolvedValue({ organizationId: "org-new" });

    renderAtRoute("/accept-invitation", <AcceptInvitation />, "/accept-invitation?token=abc123");

    await waitFor(() => expect(acceptInvitationMock).toHaveBeenCalledWith("abc123"));
  });

  it("navigates to /overview on success", async () => {
    acceptInvitationMock.mockResolvedValue({ organizationId: "org-new" });

    renderAtRoute("/accept-invitation", <AcceptInvitation />, "/accept-invitation?token=abc123");

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/overview", { replace: true }));
  });

  it("shows a specific message when the caller is already a member (CONFLICT)", async () => {
    acceptInvitationMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "You are already a member.", retryable: false }, 409));

    renderAtRoute("/accept-invitation", <AcceptInvitation />, "/accept-invitation?token=abc123");

    await waitFor(() => expect(screen.getByText("Você já é membro desta organização.")).toBeInTheDocument());
  });

  it("shows a generic expired/used message on any other failure, with a retry button", async () => {
    acceptInvitationMock.mockRejectedValue(new ApiError({ code: "INVITATION_TOKEN_UNAVAILABLE", category: "NOT_FOUND", message: "Not found.", retryable: false }, 404));

    renderAtRoute("/accept-invitation", <AcceptInvitation />, "/accept-invitation?token=abc123");

    await waitFor(() => expect(screen.getByText(/pode ter expirado ou já ter sido usado/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});
