import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { RequirementDetail } from "../../../src/routes/subjects/RequirementDetail.js";
import type { Requirement, DocumentRequest } from "../../../src/api/types.js";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock },
}));

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    requirementId: "req-1",
    subjectId: "subject-1",
    name: "Certidão Negativa de Débitos Trabalhistas",
    applicability: "APPLICABLE",
    status: "PENDING",
    assigneeUserId: undefined,
    evidenceValidUntil: undefined,
    evidenceVersionId: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function documentRequest(overrides: Partial<DocumentRequest> = {}): DocumentRequest {
  return {
    documentRequestId: "dr-1",
    subjectId: "subject-1",
    requirementId: "req-1",
    status: "OPENED",
    deadline: undefined,
    submissionCount: 0,
    issuanceGeneration: 1,
    resolvedInitialInviteDelivery: "MANUAL",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function mockRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] }),
    }),
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  mockRole("MEMBER");
  getMock.mockImplementation((path: string) => {
    if (path.includes("/document-requests")) return Promise.resolve({ documentRequests: [documentRequest()] });
    if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [requirement()] });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
});

describe("RequirementDetail", () => {
  it("renders the requirement's name/status and its sent requests", async () => {
    renderAtRoute("/subjects/:subjectId/requirements/:requirementId", <RequirementDetail />, "/subjects/subject-1/requirements/req-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Certidão Negativa de Débitos Trabalhistas" })).toBeInTheDocument());
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Enviada em/)).toBeInTheDocument());
  });

  it("shows the 'no linked document' notice when evidenceVersionId is absent", async () => {
    renderAtRoute("/subjects/:subjectId/requirements/:requirementId", <RequirementDetail />, "/subjects/subject-1/requirements/req-1");

    await waitFor(() => expect(screen.getByText("Ainda não há documento vinculado a este requisito.")).toBeInTheDocument());
  });

  it("hides the notice when evidenceVersionId is present", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/document-requests")) return Promise.resolve({ documentRequests: [] });
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [requirement({ evidenceVersionId: "ver-1", status: "SATISFIED" })] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    renderAtRoute("/subjects/:subjectId/requirements/:requirementId", <RequirementDetail />, "/subjects/subject-1/requirements/req-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Certidão Negativa de Débitos Trabalhistas" })).toBeInTheDocument());
    expect(screen.queryByText("Ainda não há documento vinculado a este requisito.")).not.toBeInTheDocument();
  });

  it("shows an honest not-found state for a requirementId that isn't in this subject's list", async () => {
    renderAtRoute("/subjects/:subjectId/requirements/:requirementId", <RequirementDetail />, "/subjects/subject-1/requirements/req-missing");

    await waitFor(() => expect(screen.getByText("Este requisito não foi encontrado.")).toBeInTheDocument());
  });

  it("opens the new-request dialog and creates a request scoped to this requirement (no requirement picker - already fixed by the URL)", async () => {
    postMock.mockResolvedValue({ documentRequest: documentRequest({ documentRequestId: "dr-2" }) });
    renderAtRoute("/subjects/:subjectId/requirements/:requirementId", <RequirementDetail />, "/subjects/subject-1/requirements/req-1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Nova solicitação" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Nova solicitação" }));
    fireEvent.change(screen.getByLabelText(/Destinatário/), { target: { value: "fornecedor@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar solicitação" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/document-archive/requirements/subject-1/req-1/document-requests", expect.objectContaining({ recipientEmail: "fornecedor@example.com" })),
    );
  });
});
