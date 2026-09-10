import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute, TEST_ORGANIZATION_ID } from "../../testUtils.js";
import { ToastProvider } from "../../../src/components/Toast.js";
import { SubjectRequests } from "../../../src/routes/subjects/SubjectRequests.js";
import type { DocumentRequest, DocumentRequestSeries, Requirement, TrackedSubject } from "../../../src/api/types.js";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, request: vi.fn() },
}));

function subject(overrides: Partial<TrackedSubject> = {}): TrackedSubject {
  return {
    subjectId: "subject-1",
    tenantId: "t1",
    type: "VENDOR",
    displayName: "Atlas Schindler",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    requirementId: "req-1",
    subjectId: "subject-1",
    name: "CND Federal",
    applicability: "APPLICABLE",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function series(overrides: Partial<DocumentRequestSeries> = {}): DocumentRequestSeries {
  return {
    seriesId: "series-1",
    subjectId: "subject-1",
    requirementId: "req-1",
    cadence: { intervalDays: 90 },
    status: "ACTIVE",
    currentCycleStartAt: "2026-09-01T00:00:00.000Z",
    nextDueAt: "2026-12-01T00:00:00.000Z",
    latestAttemptIndex: 0,
    recipientEmail: "financeiro@atlasschindler.com",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function documentRequest(overrides: Partial<DocumentRequest> = {}): DocumentRequest {
  return {
    documentRequestId: "docreq-1",
    subjectId: "subject-1",
    requirementId: "req-1",
    status: "REQUESTED",
    deadline: "2026-09-12T00:00:00.000Z",
    submissionCount: 0,
    issuanceGeneration: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function mockRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizations: [{ organizationId: TEST_ORGANIZATION_ID, displayName: "Acme", role, version: 1 }] }),
    }),
  );
}

function mockData(opts: { series?: DocumentRequestSeries[]; requests?: DocumentRequest[]; requirements?: Requirement[] } = {}) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/document-archive/series/")) return Promise.resolve({ series: opts.series ?? [] });
    if (path.includes("/document-requests")) return Promise.resolve({ documentRequests: opts.requests ?? [] });
    if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: opts.requirements ?? [requirement()] });
    if (path.startsWith("/subjects/")) return Promise.resolve({ subject: subject() });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function renderScreen() {
  return renderAtRoute("/subjects/:subjectId/requests", (
    <ToastProvider>
      <SubjectRequests />
    </ToastProvider>
  ), "/subjects/subject-1/requests");
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  vi.unstubAllGlobals();
});

describe("SubjectRequests (A14)", () => {
  it("renders the header with a back link to the subject, and lists series + requests", async () => {
    mockRole("VIEWER");
    mockData({ series: [series()], requests: [documentRequest()] });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("heading", { name: "Solicitações e recorrência" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Voltar para Atlas Schindler/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("CND Federal").length).toBeGreaterThan(0));
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.getByText("Trimestral")).toBeInTheDocument();
  });

  it("VIEWER sees no write affordances at all — no create buttons, no Ações column content", async () => {
    mockRole("VIEWER");
    mockData({ series: [series()], requests: [documentRequest()] });
    renderScreen();

    await waitFor(() => expect(screen.getByText("Trimestral")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Nova solicitação avulsa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova série recorrente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar agora" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("a WRITE role (MEMBER) sees the create actions and row actions", async () => {
    mockRole("MEMBER");
    mockData({ series: [series()], requests: [documentRequest()] });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("button", { name: "Nova solicitação avulsa" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Nova série recorrente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerar agora" })).toBeInTheDocument();
  });

  it("a cancelled series shows 'Cancelada' text with no actions, never a warning/critical tone", async () => {
    mockRole("MEMBER");
    mockData({ series: [series({ status: "CANCELLED", nextDueAt: undefined as unknown as string })] });
    renderScreen();

    await waitFor(() => expect(screen.getAllByText("Cancelada").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Gerar agora" })).not.toBeInTheDocument();
  });

  it("shows the true-empty state for both panels when the Subject has no series/requests", async () => {
    mockRole("VIEWER");
    mockData({ series: [], requests: [] });
    renderScreen();

    await waitFor(() => expect(screen.getByText(/Nenhuma série recorrente configurada/)).toBeInTheDocument());
  });

  it("'Nova solicitação avulsa' submits recipientEmail + requirementId and shows a toast on success", async () => {
    mockRole("MEMBER");
    mockData({ series: [], requests: [] });
    postMock.mockResolvedValue({ documentRequest: documentRequest() });
    renderScreen();

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Nova solicitação avulsa" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "Nova solicitação avulsa" })[0]!);

    const combobox = await screen.findByRole("combobox", { name: /Requisito/ });
    fireEvent.change(combobox, { target: { value: "CND" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "CND Federal" })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("option", { name: "CND Federal" }));

    fireEvent.change(screen.getByLabelText(/Destinatário/), { target: { value: "financeiro@atlasschindler.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar solicitação" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/document-archive/requirements/subject-1/req-1/document-requests",
        expect.objectContaining({ recipientEmail: "financeiro@atlasschindler.com" }),
      ),
    );
    await waitFor(() => expect(screen.getByText("Solicitação criada")).toBeInTheDocument());
  });

  it("cancel-series confirmation names the resource and never uses the danger variant", async () => {
    mockRole("MEMBER");
    mockData({ series: [series()] });
    postMock.mockResolvedValue({ series: series({ status: "CANCELLED" }) });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.getByText(/Cancelar série "CND Federal"/)).toBeInTheDocument());
    const confirmButton = screen.getByRole("button", { name: "Confirmar cancelamento" });
    expect(confirmButton.className).not.toContain("danger");
  });
});
