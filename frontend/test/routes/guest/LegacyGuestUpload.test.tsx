import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LegacyGuestUpload } from "../../../src/routes/guest/LegacyGuestUpload.js";

const { fetchInfoMock, submitMock, computeChecksumSha256Mock, uploadDocumentBytesMock } = vi.hoisted(() => ({
  fetchInfoMock: vi.fn(),
  submitMock: vi.fn(),
  computeChecksumSha256Mock: vi.fn(),
  uploadDocumentBytesMock: vi.fn(),
}));
vi.mock("../../../src/api/guestLegacyUpload.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/guestLegacyUpload.js")>();
  return { ...actual, fetchLegacyGuestRequestInfo: fetchInfoMock, submitLegacyGuestUpload: submitMock };
});
vi.mock("../../../src/api/documents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/api/documents.js")>();
  return { ...actual, computeChecksumSha256: computeChecksumSha256Mock, uploadDocumentBytes: uploadDocumentBytesMock };
});

function renderScreen(token = "tok-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/guest/document-requests/${token}`]}>
        <Routes>
          <Route path="/guest/document-requests/:token" element={<LegacyGuestUpload />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const REQUEST_INFO = {
  requirementName: "Certidão de Regularidade FGTS",
  deadline: "2026-09-20T00:00:00.000Z",
  allowedMediaTypes: ["application/pdf", "image/jpeg", "image/png"],
  maxUploadBytes: 10 * 1024 * 1024,
  requesterDisplayName: "Conservare Facilities ME",
};

beforeEach(() => {
  fetchInfoMock.mockReset();
  submitMock.mockReset();
  computeChecksumSha256Mock.mockReset();
  uploadDocumentBytesMock.mockReset();
  computeChecksumSha256Mock.mockResolvedValue("a".repeat(64));
  uploadDocumentBytesMock.mockResolvedValue(undefined);
});

describe("LegacyGuestUpload (G01, Block 7)", () => {
  it("shows the generic unavailable state (never a distinguishing reason) when the token is invalid/expired/revoked/already-used", async () => {
    fetchInfoMock.mockRejectedValue(new Error("invalid"));
    renderScreen();

    await waitFor(() => expect(screen.getByText("Este link não está disponível")).toBeInTheDocument());
    expect(screen.queryByText("Enviar documento solicitado")).not.toBeInTheDocument();
  });

  it("renders the requester/requirement names and the deadline once the info resolves", async () => {
    fetchInfoMock.mockResolvedValue({ request: REQUEST_INFO });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Enviar documento solicitado" })).toBeInTheDocument());
    expect(screen.getByText("Conservare Facilities ME", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Certidão de Regularidade FGTS", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/Prazo: /)).toBeInTheDocument();
    expect(screen.getByText(/uso único e não requer login/)).toBeInTheDocument();
  });

  it("rejects a file over the max size with a specific inline error, Enviar stays disabled", async () => {
    fetchInfoMock.mockResolvedValue({ request: REQUEST_INFO });
    renderScreen();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Enviar documento solicitado" })).toBeInTheDocument());

    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], "grande.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => expect(screen.getByText("Arquivo maior que 10 MB.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("rejects an unsupported media type", async () => {
    fetchInfoMock.mockResolvedValue({ request: REQUEST_INFO });
    renderScreen();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Enviar documento solicitado" })).toBeInTheDocument());

    const badFile = new File(["x"], "planilha.xlsx", { type: "application/vnd.ms-excel" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [badFile] } });

    await waitFor(() => expect(screen.getByText("Tipo de arquivo não suportado. Envie PDF, JPG ou PNG.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("submits the file (PUT to the presigned URL) and shows the final 'Envio recebido' state", async () => {
    fetchInfoMock.mockResolvedValue({ request: REQUEST_INFO });
    submitMock.mockResolvedValue({ submissionId: "s1", uploadUrl: "https://s3.example/quarantine/s1", requiredHeaders: { "x-amz-checksum-sha256": "a".repeat(64) }, expiresAt: "2026-09-10T00:10:00.000Z" });
    renderScreen();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Enviar documento solicitado" })).toBeInTheDocument());

    const file = new File(["conteudo"], "certidao.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Envio recebido" })).toBeInTheDocument());
    expect(screen.getByText(/Você não receberá uma confirmação de aprovação por este link/)).toBeInTheDocument();
    expect(submitMock).toHaveBeenCalledWith("tok-1", expect.objectContaining({ fileName: "certidao.pdf", mediaType: "application/pdf", contentLength: file.size, checksumSha256: "a".repeat(64) }));
    expect(uploadDocumentBytesMock).toHaveBeenCalledWith("https://s3.example/quarantine/s1", { "x-amz-checksum-sha256": "a".repeat(64) }, file);
  });

  it("shows a generic retry error when submission fails, never advancing to the final state", async () => {
    fetchInfoMock.mockResolvedValue({ request: REQUEST_INFO });
    submitMock.mockRejectedValue(new Error("boom"));
    renderScreen();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Enviar documento solicitado" })).toBeInTheDocument());

    const file = new File(["conteudo"], "certidao.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(screen.getByText("Não foi possível enviar. Tente novamente.")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Envio recebido" })).not.toBeInTheDocument();
  });

  it("'Remover' clears the selected file, requiring a fresh selection before Enviar re-enables", async () => {
    fetchInfoMock.mockResolvedValue({ request: REQUEST_INFO });
    renderScreen();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Enviar documento solicitado" })).toBeInTheDocument());

    const file = new File(["conteudo"], "certidao.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Selecionado: certidao.pdf/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(screen.queryByText(/Selecionado: certidao.pdf/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });
});
