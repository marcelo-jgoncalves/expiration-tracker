import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { SubjectFormDialog } from "../../../src/routes/subjects/SubjectForm.js";
import type { TrackedSubject } from "../../../src/api/types.js";

const { getMock, postMock, putMock, navigateMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, put: putMock },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function subject(overrides: Partial<TrackedSubject> = {}): TrackedSubject {
  return {
    subjectId: "subject-1",
    tenantId: "t1",
    type: "VENDOR",
    displayName: "ACME Ltda",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  putMock.mockReset();
  navigateMock.mockReset();
  window.sessionStorage.clear();
});

describe("SubjectFormDialog", () => {
  it("create: submits the new subject and navigates to its Hub, closing the modal", async () => {
    const onClose = vi.fn();
    postMock.mockResolvedValue({ subject: subject({ subjectId: "subject-new" }) });
    renderAtRoute("", <SubjectFormDialog onClose={onClose} />, "/");

    expect(await screen.findByRole("dialog", { name: "Novo fornecedor" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Nova Empresa" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith("/subjects", expect.objectContaining({ displayName: "Nova Empresa" }), expect.anything());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith("/app/org-1/subjects/subject-new");
  });

  it("create: a required-name validation failure blocks submission and never calls the API", async () => {
    const onClose = vi.fn();
    renderAtRoute("", <SubjectFormDialog onClose={onClose} />, "/");

    await screen.findByRole("dialog", { name: "Novo fornecedor" });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Informe o nome do fornecedor.")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("edit: hydrates the form from the subject's own data and closes on success without navigating", async () => {
    const onClose = vi.fn();
    getMock.mockResolvedValue({ subject: subject({ displayName: "ACME Ltda", notes: "Nota real" }) });
    putMock.mockResolvedValue({ subject: subject({ displayName: "ACME Ltda Atualizada" }) });
    renderAtRoute("", <SubjectFormDialog subjectId="subject-1" onClose={onClose} />, "/");

    expect(await screen.findByRole("dialog", { name: "Editar fornecedor" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Nome/)).toHaveValue("ACME Ltda"));

    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "ACME Ltda Atualizada" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/subjects/subject-1", expect.objectContaining({ displayName: "ACME Ltda Atualizada" }), expect.objectContaining({ expectedVersion: 3 })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("edit: an OCC conflict (409) shows the dedicated recovery notice, never a generic error", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockResolvedValue({ subject: subject({}) });
    putMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "VERSION_CONFLICT", retryable: false }));
    renderAtRoute("", <SubjectFormDialog subjectId="subject-1" onClose={() => {}} />, "/");

    await waitFor(() => expect(screen.getByLabelText(/^Nome/)).toHaveValue("ACME Ltda"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText(/Este fornecedor mudou desde que a página carregou/)).toBeInTheDocument();
    expect(screen.queryByText("VERSION_CONFLICT")).not.toBeInTheDocument();
  });

  it("create: a duplicate external-id CONFLICT from the backend is surfaced verbatim, never silently swallowed", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    postMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "Já existe um fornecedor com este identificador.", retryable: false }));
    renderAtRoute("", <SubjectFormDialog onClose={() => {}} />, "/");

    await screen.findByRole("dialog", { name: "Novo fornecedor" });
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Nova Empresa" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Já existe um fornecedor com este identificador.")).toBeInTheDocument();
  });

  it("Cancelar calls onClose without submitting", async () => {
    const onClose = vi.fn();
    renderAtRoute("", <SubjectFormDialog onClose={onClose} />, "/");

    await screen.findByRole("dialog", { name: "Novo fornecedor" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(postMock).not.toHaveBeenCalled();
  });
});
