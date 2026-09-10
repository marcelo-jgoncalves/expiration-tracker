import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GuestDocumentRequest } from "../../../src/routes/guest/GuestDocumentRequest.js";
import { GuestUnavailableError } from "../../../src/api/guestDocumentArchive.js";

const { startGuestSessionMock, listGuestDocumentTypesMock, submitGuestEvidenceMock } = vi.hoisted(() => ({
  startGuestSessionMock: vi.fn(),
  listGuestDocumentTypesMock: vi.fn(),
  submitGuestEvidenceMock: vi.fn(),
}));
vi.mock("../../../src/api/guestDocumentArchive.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/guestDocumentArchive.js")>();
  return {
    ...actual,
    startGuestSession: startGuestSessionMock,
    listGuestDocumentTypes: listGuestDocumentTypesMock,
    submitGuestEvidence: submitGuestEvidenceMock,
  };
});

function renderGuestScreen(token = "tok-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/document-archive/guest/document-requests/${token}`]}>
        <Routes>
          <Route path="/document-archive/guest/document-requests/:token" element={<GuestDocumentRequest />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  startGuestSessionMock.mockReset();
  listGuestDocumentTypesMock.mockReset();
  submitGuestEvidenceMock.mockReset();
});

describe("GuestDocumentRequest (G02)", () => {
  it("shows the generic unavailable state (never a distinguishing reason) when the session cannot be started", async () => {
    startGuestSessionMock.mockRejectedValue(new GuestUnavailableError());
    renderGuestScreen();

    await waitFor(() => expect(screen.getByText("Este link não está disponível")).toBeInTheDocument());
    expect(screen.queryByText(/Etapa/)).not.toBeInTheDocument();
  });

  it("renders the requester/requirement names and starts at Etapa 1 once the session resolves", async () => {
    startGuestSessionMock.mockResolvedValue({ expiresAt: "2026-09-12T00:00:00.000Z", subjectDisplayName: "Atlas Schindler", requirementName: "CND Federal" });
    listGuestDocumentTypesMock.mockResolvedValue({ documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal (Receita Federal)" }] });
    renderGuestScreen();

    await waitFor(() => expect(screen.getByText(/Atlas Schindler solicitou evidência para o requisito/)).toBeInTheDocument());
    expect(screen.getByText("CND Federal", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tipo de documento" })).toBeInTheDocument();
  });

  it("degrades gracefully (no names shown) when the Subject/Requirement display names are absent", async () => {
    startGuestSessionMock.mockResolvedValue({ expiresAt: "2026-09-12T00:00:00.000Z" });
    listGuestDocumentTypesMock.mockResolvedValue({ documentTypes: [] });
    renderGuestScreen();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Tipo de documento" })).toBeInTheDocument());
    expect(screen.queryByText(/solicitou evidência/)).not.toBeInTheDocument();
  });

  it("Continuar is disabled until a document type is selected, then advances to Etapa 2", async () => {
    startGuestSessionMock.mockResolvedValue({ expiresAt: "2026-09-12T00:00:00.000Z" });
    listGuestDocumentTypesMock.mockResolvedValue({ documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal" }] });
    renderGuestScreen();

    await waitFor(() => expect(screen.getByLabelText(/Tipo de documento \*/)).toBeInTheDocument());
    const continueButton = screen.getByRole("button", { name: "Continuar" });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Tipo de documento \*/), { target: { value: "dt-1" } });
    expect(screen.getByRole("button", { name: "Continuar" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Arquivo" })).toBeInTheDocument());
  });

  it("rejects a file over 10MB with a specific inline error, never advancing", async () => {
    startGuestSessionMock.mockResolvedValue({ expiresAt: "2026-09-12T00:00:00.000Z" });
    listGuestDocumentTypesMock.mockResolvedValue({ documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal" }] });
    renderGuestScreen();

    await waitFor(() => expect(screen.getByLabelText(/Tipo de documento \*/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Tipo de documento \*/), { target: { value: "dt-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Arquivo" })).toBeInTheDocument());

    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], "grande.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => expect(screen.getByText("Arquivo excede o limite de 10 MB.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("submits evidence and shows the final 'Evidência enviada' state, never implying approval", async () => {
    startGuestSessionMock.mockResolvedValue({ expiresAt: "2026-09-12T00:00:00.000Z" });
    listGuestDocumentTypesMock.mockResolvedValue({ documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal" }] });
    submitGuestEvidenceMock.mockResolvedValue({ documentId: "doc-1", versionId: "ver-1", seq: 1 });
    renderGuestScreen();

    await waitFor(() => expect(screen.getByLabelText(/Tipo de documento \*/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Tipo de documento \*/), { target: { value: "dt-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Arquivo" })).toBeInTheDocument());

    const file = new File(["conteudo"], "cnd.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Revisar e enviar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enviar evidência" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Evidência enviada" })).toBeInTheDocument());
    expect(screen.getByText(/esta confirmação não significa que o documento foi aprovado/)).toBeInTheDocument();
    expect(submitGuestEvidenceMock).toHaveBeenCalledWith("tok-1", expect.objectContaining({ fileName: "cnd.pdf", documentTypeId: "dt-1" }));
  });

  it("a submission failure shows the generic retry copy, never a distinguishing reason (backend collapses every submission failure)", async () => {
    startGuestSessionMock.mockResolvedValue({ expiresAt: "2026-09-12T00:00:00.000Z" });
    listGuestDocumentTypesMock.mockResolvedValue({ documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal" }] });
    submitGuestEvidenceMock.mockRejectedValue(new GuestUnavailableError());
    renderGuestScreen();

    await waitFor(() => expect(screen.getByLabelText(/Tipo de documento \*/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Tipo de documento \*/), { target: { value: "dt-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Arquivo" })).toBeInTheDocument());
    const file = new File(["conteudo"], "cnd.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Revisar e enviar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enviar evidência" }));

    await waitFor(() => expect(screen.getByText("Não foi possível enviar. Tente novamente.")).toBeInTheDocument());
  });
});
