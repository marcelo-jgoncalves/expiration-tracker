import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute, TEST_ORGANIZATION_ID } from "../../testUtils.js";
import { DocumentTypeEditor } from "../../../src/routes/document-types/DocumentTypeEditor.js";
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
    version: 3,
    ...overrides,
  };
}

/** Same `fetch`-vs-`apiClient` split as `DocumentTypesCollection.test.tsx` - see that file's
 * `mockRole` doc comment. */
function mockRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER", type: DocumentType) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizations: [{ organizationId: TEST_ORGANIZATION_ID, displayName: "Acme", role, version: 1 }] }),
    }),
  );
  getMock.mockImplementation((path: string) => {
    if (path.includes("/document-types/")) return Promise.resolve({ documentType: type });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  requestMock.mockReset();
  vi.unstubAllGlobals();
});

describe("DocumentTypeEditor (A20)", () => {
  it("shows initial loading, then the type name and empty-fields state", async () => {
    mockRole("VIEWER", documentType());
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");

    expect(screen.getByText("Carregando tipo de documento…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "CND Federal" })).toBeInTheDocument());
    expect(screen.getByText("Nenhum campo definido ainda.")).toBeInTheDocument();
  });

  it("shows a read-only notice and hides 'Adicionar campo' for a MEMBER", async () => {
    mockRole("MEMBER", documentType());
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");
    await waitFor(() => expect(screen.getByText("Modo leitura — apenas administradores editam este catálogo.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Adicionar campo" })).not.toBeInTheDocument();
  });

  it("shows 'Adicionar campo' for an ADMIN and renders the fixed retroactivity note", async () => {
    mockRole("ADMIN", documentType());
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Adicionar campo" })).toBeInTheDocument());
    expect(screen.getByText(/nunca invalida retroativamente Documentos já existentes/)).toBeInTheDocument();
  });

  it("renders an existing field with its value type, required indicator, and options", async () => {
    mockRole(
      "ADMIN",
      documentType({
        metadataFields: [
          { fieldId: "f1", name: "Categoria de risco", valueType: "SINGLE_SELECT", required: true, status: "ACTIVE", options: [{ optionId: "o1", label: "Alto", status: "ACTIVE" }], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");
    await waitFor(() => expect(screen.getByText("Categoria de risco")).toBeInTheDocument());
    expect(screen.getByText(/Obrigatório/)).toBeInTheDocument();
    expect(screen.getByText(/Alto/)).toBeInTheDocument();
  });

  it("renders an archived field with reduced-emphasis status and an admin-only Reativar action", async () => {
    mockRole(
      "ADMIN",
      documentType({
        metadataFields: [
          { fieldId: "f1", name: "Campo antigo", valueType: "TEXT", required: false, status: "ARCHIVED", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    );
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reativar campo" })).toBeInTheDocument());
  });

  it("shows a neutral notice for a DEPRECATED type without fabricating a referencing-document count", async () => {
    mockRole("ADMIN", documentType({ status: "DEPRECATED" }));
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");
    await waitFor(() => expect(screen.getByText(/Tipo descontinuado/)).toBeInTheDocument());
  });

  // Codex block-review finding (HIGH): this component's own header comment promised rename/
  // required/option editing that didn't actually exist - only archive/reactivate of the whole
  // field. This test would fail against the pre-fix code (no "Editar campo" control at all).
  it("renames an existing field and toggles required via 'Editar campo'", async () => {
    mockRole(
      "ADMIN",
      documentType({
        metadataFields: [{ fieldId: "f1", name: "Categoria", valueType: "TEXT", required: false, status: "ACTIVE", createdAt: "x", updatedAt: "x" }],
      }),
    );
    let updateBody: Record<string, unknown> | undefined;
    requestMock.mockImplementation((_path: string, options: { body?: Record<string, unknown> }) => {
      updateBody = options?.body;
      return Promise.resolve({ documentType: documentType({ metadataFields: [{ fieldId: "f1", name: "Categoria de risco", valueType: "TEXT", required: true, status: "ACTIVE", createdAt: "x", updatedAt: "x" }] }) });
    });
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar campo" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Editar campo" }));
    fireEvent.change(screen.getByLabelText(/Nome do campo/), { target: { value: "Categoria de risco" } });
    fireEvent.click(screen.getByLabelText("Obrigatório"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateBody?.["name"]).toBe("Categoria de risco"));
    expect(updateBody?.["required"]).toBe(true);
    expect(updateBody?.["expectedDocumentTypeVersion"]).toBe(3);
  });

  it("adds a SINGLE_SELECT field with comma-separated options", async () => {
    mockRole("ADMIN", documentType());
    postMock.mockResolvedValue({ documentType: documentType({ metadataFields: [{ fieldId: "f1", name: "Prioridade", valueType: "SINGLE_SELECT", required: false, status: "ACTIVE", options: [{ optionId: "o1", label: "Baixo", status: "ACTIVE" }, { optionId: "o2", label: "Alto", status: "ACTIVE" }], createdAt: "x", updatedAt: "x" }] }) });
    renderAtRoute("/settings/document-types/:documentTypeId", <DocumentTypeEditor />, "/settings/document-types/doctype-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Adicionar campo" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo" }));
    fireEvent.change(screen.getByLabelText(/Nome do campo/), { target: { value: "Prioridade" } });
    fireEvent.change(screen.getByLabelText(/Tipo de valor/), { target: { value: "SINGLE_SELECT" } });
    fireEvent.change(screen.getByLabelText(/Opções/), { target: { value: "Baixo, Alto" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      expect.stringContaining("/metadata-fields"),
      expect.objectContaining({ name: "Prioridade", valueType: "SINGLE_SELECT", options: ["Baixo", "Alto"], expectedDocumentTypeVersion: 3 }),
    ));
  });
});
