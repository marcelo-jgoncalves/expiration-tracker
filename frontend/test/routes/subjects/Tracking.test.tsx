import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { Tracking } from "../../../src/routes/subjects/Tracking.js";
import { ToastProvider } from "../../../src/components/Toast.js";
import type { RequirementAssignment, TrackedSubject } from "../../../src/api/types.js";

const { getMock, postMock, putMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
  deleteMock: vi.fn(),
}));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, put: putMock, delete: deleteMock },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function subject(overrides: Partial<TrackedSubject> = {}): TrackedSubject {
  return {
    subjectId: "subject-1",
    tenantId: "t1",
    type: "VENDOR",
    displayName: "Conservare Facilities ME",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function assignment(overrides: Partial<RequirementAssignment> = {}): RequirementAssignment {
  return {
    assignmentId: "a1",
    subjectId: "subject-1",
    tenantId: "t1",
    requirementName: "Certidão de regularidade",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function withRole(role: string) {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

function renderList() {
  return renderAtRoute(
    "/subjects/:subjectId/tracking",
    <ToastProvider>
      <Tracking />
    </ToastProvider>,
    "/subjects/subject-1/tracking",
  );
}

function renderDetail(assignmentId = "a1") {
  return renderAtRoute(
    "/subjects/:subjectId/tracking/:assignmentId",
    <ToastProvider>
      <Tracking />
    </ToastProvider>,
    `/subjects/subject-1/tracking/${assignmentId}`,
  );
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  putMock.mockReset();
  deleteMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("Tracking (A10, Block 7) - list", () => {
  it("VIEWER sees the list but no write actions (Novo vínculo legado / Vincular / Solicitar / Editar / Excluir all hidden)", async () => {
    withRole("VIEWER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/requirements")) return Promise.resolve({ assignments: [assignment()] });
      if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    renderList();

    await waitFor(() => expect(screen.getByText("Certidão de regularidade")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Novo vínculo legado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vincular item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solicitar documento" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir vínculo" })).not.toBeInTheDocument();
  });

  it("MEMBER sees write actions but not Excluir vínculo (ADMIN_ROLES only)", async () => {
    withRole("MEMBER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/requirements")) return Promise.resolve({ assignments: [assignment()] });
      if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    renderList();

    await waitFor(() => expect(screen.getByRole("button", { name: "Novo vínculo legado" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Vincular item" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir vínculo" })).not.toBeInTheDocument();
  });

  it("ADMIN sees Excluir vínculo too", async () => {
    withRole("ADMIN");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/requirements")) return Promise.resolve({ assignments: [assignment()] });
      if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    renderList();

    await waitFor(() => expect(screen.getByRole("button", { name: "Excluir vínculo" })).toBeInTheDocument());
  });

  it("shows the empty state with a link to Requisitos documentais when there are no assignments", async () => {
    withRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/requirements")) return Promise.resolve({ assignments: [] });
      if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    renderList();

    await waitFor(() => expect(screen.getByText(/Nenhum vínculo legado registrado/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Ir para Requisitos documentais" })).toBeInTheDocument();
  });

  it("creates a new legacy assignment via 'Novo vínculo legado'", async () => {
    withRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/requirements")) return Promise.resolve({ assignments: [] });
      if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    postMock.mockResolvedValue({ assignment: assignment() });
    renderList();

    await waitFor(() => expect(screen.getByRole("button", { name: "Novo vínculo legado" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Novo vínculo legado" }).click();
    const input = await screen.findByLabelText(/Nome do vínculo/);
    fireEvent.change(input, { target: { value: "Alvará" } });
    screen.getByRole("button", { name: "Criar vínculo" }).click();

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/subjects/subject-1/requirements", { requirementName: "Alvará" }));
  });

  // Codex review round 1 (Block 7, D-267) BLOQUEANTE finding, corrected: the guest token is
  // returned ONLY at creation - a MANUAL default (or a failed/kill-switched EMAIL attempt)
  // used to discard it entirely, leaving the operator with no way to ever share the link.
  it("'Solicitar documento' shows a copyable guest link when delivery is MANUAL (the token would otherwise be lost forever)", async () => {
    withRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/requirements")) return Promise.resolve({ assignments: [assignment()] });
      if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    postMock.mockResolvedValue({ request: { documentRequestId: "r1" }, guestToken: "tok-abc123" });
    renderList();

    await waitFor(() => expect(screen.getByText("Certidão de regularidade")).toBeInTheDocument());
    screen.getByRole("button", { name: "Solicitar documento" }).click();
    const input = await screen.findByLabelText(/Destinatário/);
    fireEvent.change(input, { target: { value: "fornecedor@example.com" } });
    screen.getByRole("button", { name: "Solicitar" }).click();

    await waitFor(() => expect(screen.getByText(/tok-abc123/)).toBeInTheDocument());
    expect(screen.getByText(/Este link só é exibido agora/)).toBeInTheDocument();
  });

  it("'Solicitar documento' shows a warning (not silent success) when EMAIL delivery failed, still with the copyable link", async () => {
    withRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/requirements")) return Promise.resolve({ assignments: [assignment()] });
      if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    postMock.mockResolvedValue({ request: { documentRequestId: "r1" }, guestToken: "tok-xyz789", initialInviteDeliveryStatus: "FAILED" });
    renderList();

    await waitFor(() => expect(screen.getByText("Certidão de regularidade")).toBeInTheDocument());
    screen.getByRole("button", { name: "Solicitar documento" }).click();
    const input = await screen.findByLabelText(/Destinatário/);
    fireEvent.change(input, { target: { value: "fornecedor@example.com" } });
    screen.getByRole("button", { name: "Solicitar" }).click();

    await waitFor(() => expect(screen.getByText(/e-mail não pôde ser enviado automaticamente/)).toBeInTheDocument());
    expect(screen.getByText(/tok-xyz789/)).toBeInTheDocument();
  });
});

describe("Tracking (A10, Block 7) - detail (Snapshot + Timeline)", () => {
  it("renders the Snapshot block and an empty timeline message when no requests exist yet", async () => {
    withRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/document-requests")) return Promise.resolve({ requests: [] });
      if (path.endsWith("/requirements/a1")) return Promise.resolve({ assignment: assignment() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    renderDetail();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Certidão de regularidade" })).toBeInTheDocument());
    expect(screen.getByText(/Este status não muda automaticamente/)).toBeInTheDocument();
    expect(screen.getByText("Nenhuma solicitação emitida ainda.")).toBeInTheDocument();
  });

  it("renders timeline entries with their status and allows revoking an active request", async () => {
    withRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/document-requests")) {
        return Promise.resolve({
          requests: [
            {
              documentRequestId: "r1",
              subjectId: "subject-1",
              assignmentId: "a1",
              recipientEmail: "fornecedor@example.com",
              requestedAt: "2026-01-05T00:00:00.000Z",
              status: "REQUESTED",
              submissionCount: 0,
              createdAt: "2026-01-05T00:00:00.000Z",
              updatedAt: "2026-01-05T00:00:00.000Z",
              version: 1,
            },
          ],
        });
      }
      if (path.endsWith("/submissions")) return Promise.resolve({ submissions: [] });
      if (path.endsWith("/requirements/a1")) return Promise.resolve({ assignment: assignment() });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    postMock.mockResolvedValue(undefined);
    renderDetail();

    await waitFor(() => expect(screen.getByText(/fornecedor@example.com/)).toBeInTheDocument());
    expect(screen.getByText("Aguardando abertura")).toBeInTheDocument();
    // Codex review round 1 (Block 7, D-267) ALTO finding, corrected: "Revogar" now opens a
    // confirmation dialog (naming the recipient/consequence) before actually revoking.
    screen.getByRole("button", { name: "Revogar" }).click();
    await waitFor(() => expect(screen.getByText(/O link do convidado deixará de funcionar imediatamente/)).toBeInTheDocument());
    screen.getByRole("button", { name: "Confirmar revogação" }).click();

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/subjects/subject-1/document-requests/r1/revoke", undefined, { expectedVersion: 1 }));
  });

  it("shows 'Item vinculado não está mais disponível' when the linked item fetch fails (archived/deleted item)", async () => {
    withRole("OWNER");
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/document-requests")) return Promise.resolve({ requests: [] });
      if (path.includes("/items/")) return Promise.reject(new Error("not found"));
      if (path.endsWith("/requirements/a1")) return Promise.resolve({ assignment: assignment({ status: "SATISFIED", linkedItemId: "item-1", satisfiedAt: "2026-01-03T00:00:00.000Z" }) });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    renderDetail();

    await waitFor(() => expect(screen.getByText(/Item vinculado não está mais disponível/)).toBeInTheDocument());
  });
});
