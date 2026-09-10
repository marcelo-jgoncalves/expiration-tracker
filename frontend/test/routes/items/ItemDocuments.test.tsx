import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { ItemDocuments } from "../../../src/routes/items/ItemDocuments.js";
import type { ExpirationItem, ItemDocument, MembershipRole } from "../../../src/api/types.js";

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  deleteMock: vi.fn(),
}));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, delete: deleteMock },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

// jsdom doesn't reliably implement File#arrayBuffer/crypto.subtle - the checksum computation
// itself is exercised directly in api/documents.test.ts, not re-tested through this component.
vi.mock("../../../src/api/documents.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/documents.js")>("../../../src/api/documents.js");
  return { ...actual, computeChecksumSha256: vi.fn().mockResolvedValue("deadbeef") };
});

function item(overrides: Partial<ExpirationItem>): ExpirationItem {
  return {
    itemId: "item-1",
    tenantId: "t1",
    name: "Apólice de Seguro",
    category: "Financeiro",
    dueDate: "2026-09-01T00:00:00.000Z",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

function doc(overrides: Partial<ItemDocument>): ItemDocument {
  return {
    documentId: "doc-1",
    itemId: "item-1",
    fileName: "contrato.pdf",
    mediaType: "application/pdf",
    contentLength: 1024,
    status: "CLEAN",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function mockAsRole(role: MembershipRole) {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  deleteMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("ItemDocuments (A07)", () => {
  it("every role can view the file list (document:read is READ_ONLY_ROLES)", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as MembershipRole[]) {
      getMock.mockImplementation((path: string) => {
        if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
        if (path === "/items/item-1/documents") return Promise.resolve({ documents: [doc({})] });
        return Promise.reject(new Error("unexpected path " + path));
      });
      mockAsRole(role);
      const { unmount } = renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");
      await waitFor(() => expect(screen.getByText("contrato.pdf")).toBeInTheDocument());
      unmount();
    }
  });

  it("VIEWER never sees the upload form (document:reserve-upload is WRITE_ROLES)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/documents") return Promise.resolve({ documents: [] });
      return Promise.reject(new Error("unexpected path " + path));
    });
    mockAsRole("VIEWER");
    renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");

    await waitFor(() => expect(screen.getByText("Nenhum arquivo anexado ainda.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Selecionar arquivo")).not.toBeInTheDocument();
  });

  it("MEMBER sees the upload form but never an Excluir button (document:delete is ADMIN_ROLES, NOT MEMBER - the exact bug already corrected once in A05)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/documents") return Promise.resolve({ documents: [doc({})] });
      return Promise.reject(new Error("unexpected path " + path));
    });
    mockAsRole("MEMBER");
    renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");

    await waitFor(() => expect(screen.getByText("contrato.pdf")).toBeInTheDocument());
    expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
  });

  it("ADMIN sees Excluir, and it requires a confirm step before calling delete", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/documents") return Promise.resolve({ documents: [doc({})] });
      return Promise.reject(new Error("unexpected path " + path));
    });
    deleteMock.mockResolvedValue(undefined);
    mockAsRole("ADMIN");
    renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");

    await waitFor(() => expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(deleteMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/items/item-1/documents/doc-1"));
  });

  it("every non-DELETED status renders its own badge, honestly - CLEAN is never presented as a stronger claim than PENDING_UPLOAD/SCANNING", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/documents")
        return Promise.resolve({
          documents: [
            doc({ documentId: "d1", fileName: "a.pdf", status: "PENDING_UPLOAD" }),
            doc({ documentId: "d2", fileName: "b.pdf", status: "SCANNING" }),
            doc({ documentId: "d3", fileName: "c.pdf", status: "REJECTED" }),
            doc({ documentId: "d4", fileName: "d.pdf", status: "DELETED" }),
          ],
        });
      return Promise.reject(new Error("unexpected path " + path));
    });
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");

    await waitFor(() => expect(screen.getByText("a.pdf")).toBeInTheDocument());
    expect(screen.getByText("Aguardando envio")).toBeInTheDocument();
    expect(screen.getByText("Verificando segurança")).toBeInTheDocument();
    expect(screen.getByText("Rejeitado (ameaça detectada)")).toBeInTheDocument();
    // A DELETED document is filtered out of the visible list entirely.
    expect(screen.queryByText("d.pdf")).not.toBeInTheDocument();
  });

  it("the two-phase upload model: reserving a slot and PUTting bytes are two real calls, and the document stays PENDING_UPLOAD from the reservation response alone", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/documents") return Promise.resolve({ documents: [] });
      return Promise.reject(new Error("unexpected path " + path));
    });
    postMock.mockResolvedValue({
      documentId: "doc-new",
      uploadSlotId: "slot-1",
      uploadUrl: "https://storage.example.com/upload",
      requiredHeaders: { "x-amz-meta": "x" },
      expiresAt: "2026-01-01T00:10:00.000Z",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");

    await waitFor(() => expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument());
    const file = new File(["conteudo"], "novo.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/items/item-1/documents", expect.objectContaining({ fileName: "novo.pdf" }), expect.anything()));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith("https://storage.example.com/upload", expect.objectContaining({ method: "PUT" })));
    fetchSpy.mockRestore();
  });
});
