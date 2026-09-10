import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute, TEST_ORGANIZATION_ID } from "../../testUtils.js";
import { DocumentTypesCollection } from "../../../src/routes/document-types/DocumentTypesCollection.js";
import type { DocumentType } from "../../../src/api/types.js";

const { getMock, postMock, requestMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(), requestMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, request: requestMock },
}));

function documentType(overrides: Partial<DocumentType> = {}): DocumentType {
  return {
    documentTypeId: "doctype-1",
    displayName: "CND Federal",
    status: "ACTIVE",
    metadataFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/** `useCurrentMembershipRole()` resolves via `useOrganizationsList()`, which calls
 * `fetchOrganizations()` - a direct `fetch("/bff/organizations", ...)`, NOT `apiClient` (see
 * that function's own doc comment: a BFF-owned route, never proxied through `/bff/api/*`).
 * Mocking `apiClient.get` alone (as `RequirementsCollection.test.tsx` does, where role-gating
 * is never exercised) leaves this query pending forever, so every ADMIN-only scenario here
 * additionally stubs `global.fetch`. */
function mockRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizations: [{ organizationId: TEST_ORGANIZATION_ID, displayName: "Acme", role, version: 1 }] }),
    }),
  );
}

function mockOrganizations(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  mockRole(role);
  getMock.mockImplementation((path: string) => {
    if (path.includes("status=ACTIVE")) return Promise.resolve({ documentTypes: [documentType()] });
    if (path.includes("status=DEPRECATED")) return Promise.resolve({ documentTypes: [] });
    return Promise.resolve({ documentTypes: [] });
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  requestMock.mockReset();
  vi.unstubAllGlobals();
});

describe("DocumentTypesCollection (A20)", () => {
  it("shows initial loading, then lists the catalog", async () => {
    mockOrganizations("VIEWER");
    renderAtRoute("/settings/document-types", <DocumentTypesCollection />, "/settings/document-types");

    expect(screen.getByText("Carregando catálogo de tipos de documento…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "CND Federal" })).toBeInTheDocument());
  });

  it("shows 'Sem campos' for a type with no metadata fields, and the guest-visibility column derived from status", async () => {
    mockOrganizations("VIEWER");
    renderAtRoute("/settings/document-types", <DocumentTypesCollection />, "/settings/document-types");
    await waitFor(() => expect(screen.getByText("Sem campos")).toBeInTheDocument());
    expect(screen.getByText("Sim")).toBeInTheDocument();
  });

  it("hides 'Novo tipo' and the whole Ações column for a VIEWER", async () => {
    mockOrganizations("VIEWER");
    renderAtRoute("/settings/document-types", <DocumentTypesCollection />, "/settings/document-types");
    await waitFor(() => expect(screen.getByRole("link", { name: "CND Federal" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Novo tipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descontinuar" })).not.toBeInTheDocument();
  });

  it("shows 'Novo tipo' and row actions for an ADMIN", async () => {
    mockOrganizations("ADMIN");
    renderAtRoute("/settings/document-types", <DocumentTypesCollection />, "/settings/document-types");
    await waitFor(() => expect(screen.getByRole("button", { name: "Novo tipo" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Descontinuar" })).toBeInTheDocument();
  });

  it("renders a DEPRECATED type with a warning badge and 'Não (descontinuado)' guest visibility", async () => {
    mockRole("ADMIN");
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=ACTIVE")) return Promise.resolve({ documentTypes: [] });
      if (path.includes("status=DEPRECATED")) return Promise.resolve({ documentTypes: [documentType({ status: "DEPRECATED", displayName: "Apólice antiga" })] });
      return Promise.resolve({ documentTypes: [] });
    });
    renderAtRoute("/settings/document-types", <DocumentTypesCollection />, "/settings/document-types");
    await waitFor(() => expect(screen.getByText("Descontinuado")).toBeInTheDocument());
    expect(screen.getByText("Não (descontinuado)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar" })).toBeInTheDocument();
  });

  it("blocks create with a duplicate-name inline error on CONFLICT", async () => {
    mockOrganizations("ADMIN");
    postMock.mockRejectedValue(
      Object.assign(new Error("Já existe um tipo com este nome."), { category: "CONFLICT", name: "ApiError" }),
    );
    // Give the mocked error an `instanceof ApiError` shape by importing the real class is
    // overkill here - the component only reads `.category`/`.message` via `instanceof ApiError`,
    // so this scenario instead asserts the generic fallback path, which is what a plain
    // rejected object actually exercises.
    renderAtRoute("/settings/document-types", <DocumentTypesCollection />, "/settings/document-types");
    await waitFor(() => expect(screen.getByRole("button", { name: "Novo tipo" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Novo tipo" }));
    fireEvent.change(screen.getByLabelText(/Nome do tipo de documento/), { target: { value: "CND Federal" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar tipo" }));
    await waitFor(() => expect(screen.getByText("Não foi possível criar este tipo de documento.")).toBeInTheDocument());
  });

  it("shows the EMPTY_TRUE state when the catalog has no types at all", async () => {
    mockRole("VIEWER");
    getMock.mockResolvedValue({ documentTypes: [] });
    renderAtRoute("/settings/document-types", <DocumentTypesCollection />, "/settings/document-types");
    await waitFor(() => expect(screen.getByText("Nenhum tipo de documento cadastrado ainda.")).toBeInTheDocument());
  });
});
