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

  it("Codex block-review finding: a failed delete is surfaced as a visible error, not a confirm button that silently does nothing", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/documents") return Promise.resolve({ documents: [doc({})] });
      return Promise.reject(new Error("unexpected path " + path));
    });
    deleteMock.mockRejectedValue(new Error("network down"));
    mockAsRole("ADMIN");
    renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");

    await waitFor(() => expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível excluir este arquivo."));
    // The document is still listed - a failed delete never silently removes it from view.
    expect(screen.getByText("contrato.pdf")).toBeInTheDocument();
  });

  it("every real DocumentStatus (including CLEAN/UNSUPPORTED/TIMEOUT) renders its own honest badge - CLEAN is never presented as a stronger claim than PENDING_UPLOAD/SCANNING, and DELETED is filtered out entirely", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/documents")
        return Promise.resolve({
          documents: [
            doc({ documentId: "d1", fileName: "a.pdf", status: "PENDING_UPLOAD" }),
            doc({ documentId: "d2", fileName: "b.pdf", status: "SCANNING" }),
            doc({ documentId: "d3", fileName: "c.pdf", status: "CLEAN" }),
            doc({ documentId: "d4", fileName: "d.pdf", status: "REJECTED" }),
            doc({ documentId: "d5", fileName: "e.pdf", status: "UNSUPPORTED" }),
            doc({ documentId: "d6", fileName: "f.pdf", status: "TIMEOUT" }),
            doc({ documentId: "d7", fileName: "g.pdf", status: "DELETED" }),
          ],
        });
      return Promise.reject(new Error("unexpected path " + path));
    });
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");

    await waitFor(() => expect(screen.getByText("a.pdf")).toBeInTheDocument());
    expect(screen.getByText("Aguardando envio")).toBeInTheDocument();
    expect(screen.getByText("Verificando segurança")).toBeInTheDocument();
    expect(screen.getByText("Verificado (segurança) — conteúdo não conferido")).toBeInTheDocument();
    expect(screen.getByText("Rejeitado (ameaça detectada)")).toBeInTheDocument();
    expect(screen.getByText("Arquivo não suportado")).toBeInTheDocument();
    expect(screen.getByText("Envio expirado")).toBeInTheDocument();
    // A DELETED document is filtered out of the visible list entirely.
    expect(screen.queryByText("g.pdf")).not.toBeInTheDocument();
  });

  describe("the two-phase upload model", () => {
    function mockReservation() {
      postMock.mockResolvedValue({
        documentId: "doc-new",
        uploadSlotId: "slot-1",
        uploadUrl: "https://storage.example.com/upload",
        requiredHeaders: { "x-amz-meta": "x" },
        expiresAt: "2026-01-01T00:10:00.000Z",
      });
    }

    async function renderWithEmptyList() {
      getMock.mockImplementation((path: string) => {
        if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
        if (path === "/items/item-1/documents") return Promise.resolve({ documents: [] });
        return Promise.reject(new Error("unexpected path " + path));
      });
      mockAsRole("OWNER");
      renderAtRoute("/items/:itemId/documents", <ItemDocuments />, "/items/item-1/documents");
      await waitFor(() => expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument());
    }

    it("reserves the slot (phase 1) and only then PUTs the bytes (phase 2) - never the other order, and the PUT carries the real file body and required headers", async () => {
      mockReservation();
      const callOrder: string[] = [];
      postMock.mockImplementation(async () => {
        callOrder.push("reserve");
        return {
          documentId: "doc-new",
          uploadSlotId: "slot-1",
          uploadUrl: "https://storage.example.com/upload",
          requiredHeaders: { "x-amz-meta": "x" },
          expiresAt: "2026-01-01T00:10:00.000Z",
        };
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callOrder.push("put");
        return new Response(null, { status: 200 });
      });
      await renderWithEmptyList();

      const file = new File(["conteudo"], "novo.pdf", { type: "application/pdf" });
      fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [file] } });
      fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));

      await waitFor(() => expect(callOrder).toEqual(["reserve", "put"]));
      expect(fetchSpy).toHaveBeenCalledWith("https://storage.example.com/upload", {
        method: "PUT",
        headers: { "x-amz-meta": "x" },
        body: file,
      });
      fetchSpy.mockRestore();
    });

    it("a reservation failure never attempts the PUT, and is surfaced as a visible error", async () => {
      postMock.mockRejectedValue(new Error("quota exceeded"));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await renderWithEmptyList();

      const file = new File(["conteudo"], "novo.pdf", { type: "application/pdf" });
      fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [file] } });
      fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível enviar o arquivo."));
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("a PUT failure (phase 2) is surfaced as a visible error and never invalidates/refreshes the document list as if it had succeeded", async () => {
      mockReservation();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
      await renderWithEmptyList();
      getMock.mockClear();

      const file = new File(["conteudo"], "novo.pdf", { type: "application/pdf" });
      fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [file] } });
      fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível enviar o arquivo."));
      // No re-fetch of the document list was triggered by a failed upload.
      expect(getMock).not.toHaveBeenCalledWith("/items/item-1/documents", expect.anything());
      fetchSpy.mockRestore();
    });
  });
});
