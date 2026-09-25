import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { SubjectsCollection } from "../../../src/routes/subjects/SubjectsCollection.js";
import type { TrackedSubject } from "../../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function mockAsRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

function subject(overrides: Partial<TrackedSubject>): TrackedSubject {
  return {
    subjectId: "subject-1",
    tenantId: "t1",
    type: "VENDOR",
    displayName: "ACME Ltda",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  getMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("SubjectsCollection", () => {
  it("shows initial loading, then lists subjects with a link to their detail page", async () => {
    getMock.mockResolvedValue({ subjects: [subject({})] });
    renderAtRoute("/subjects", <SubjectsCollection />, "/subjects");

    expect(screen.getByText("Carregando fornecedores…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "ACME Ltda" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "ACME Ltda" })).toHaveAttribute("href", "/app/org-1/subjects/subject-1");
  });

  it("shows the true-empty state for a genuinely empty ACTIVE list", async () => {
    getMock.mockResolvedValue({ subjects: [] });
    renderAtRoute("/subjects", <SubjectsCollection />, "/subjects");

    await waitFor(() => expect(screen.getByText(/Nenhum fornecedor cadastrado ainda\./)).toBeInTheDocument());
  });

  // Mutation: failing to apply ARCHIVED would leave the active record visible.
  it("switching to the Arquivados tab queries status=ARCHIVED", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=ARCHIVED")) return Promise.resolve({ subjects: [] });
      return Promise.resolve({ subjects: [subject({})] });
    });
    renderAtRoute("/subjects", <SubjectsCollection />, "/subjects");
    await waitFor(() => expect(screen.getByRole("button", { name: /^Arquivados/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Arquivados/ }));

    await waitFor(() => expect(screen.getByText("Nenhum fornecedor neste status.")).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining("status=ARCHIVED"), expect.anything());
  });

  it("'Novo fornecedor' opens the create modal (SubjectFormDialog) instead of navigating to a route", async () => {
    mockAsRole("OWNER");
    getMock.mockResolvedValue({ subjects: [subject({})] });
    renderAtRoute("/subjects", <SubjectsCollection />, "/subjects");

    await waitFor(() => expect(screen.getByRole("button", { name: "Novo fornecedor" })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Novo fornecedor" })[0]!);

    expect(await screen.findByRole("dialog", { name: "Novo fornecedor" })).toBeInTheDocument();
  });

  it("the row 'Editar' action opens the edit modal pre-filled with the subject's own data", async () => {
    mockAsRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path === "/subjects/subject-1") return Promise.resolve({ subject: subject({ displayName: "ACME Ltda", notes: "Nota real" }) });
      return Promise.resolve({ subjects: [subject({ displayName: "ACME Ltda", notes: "Nota real" })] });
    });
    renderAtRoute("/subjects", <SubjectsCollection />, "/subjects");

    await waitFor(() => expect(screen.getByRole("link", { name: "ACME Ltda" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Editar ACME Ltda" }));

    expect(await screen.findByRole("dialog", { name: "Editar fornecedor" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Nome/)).toHaveValue("ACME Ltda"));
  });

  it("maps an AUTHORIZATION error to the permission-limited empty state", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockRejectedValue(new ApiError({ code: "AUTHORIZATION_DENIED", category: "AUTHORIZATION", message: "nope", retryable: false }));
    renderAtRoute("/subjects", <SubjectsCollection />, "/subjects");

    await waitFor(() => expect(screen.getByText("Você não tem acesso a este conteúdo.")).toBeInTheDocument());
  });
});
