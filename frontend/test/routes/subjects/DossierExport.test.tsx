import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { DossierExport } from "../../../src/routes/subjects/DossierExport.js";
import { ApiError } from "../../../src/api/errors.js";
import type { TrackedSubject } from "../../../src/api/types.js";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, put: vi.fn(), delete: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function withRole(role: string) {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

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

function render(initialEntry = "/subjects/subject-1/dossier") {
  return renderAtRoute("/subjects/:subjectId/dossier", <DossierExport />, initialEntry);
}

function mockSubjectAndPreview(previewOverrides: { requirementCount?: number } = {}) {
  getMock.mockImplementation((path: string) => {
    if (path === "/subjects/subject-1") return Promise.resolve({ subject: subject() });
    return Promise.reject(new Error(`unexpected GET path ${path}`));
  });
  postMock.mockImplementation((path: string) => {
    if (path === "/document-archive/subjects/subject-1/dossier") {
      const rowCount = previewOverrides.requirementCount ?? 2;
      return Promise.resolve({
        run: { runId: "run-1", subjectId: "subject-1", status: "PREVIEW_READY", scopeHash: "scope_abc123", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" },
        rows: Array.from({ length: rowCount }, (_, i) => ({ requirementId: `r${i}`, name: `Req ${i}`, status: "SATISFIED" })),
      });
    }
    return Promise.reject(new Error(`unexpected POST path ${path}`));
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  fetchOrganizationsMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

describe("DossierExport (A17, Block 10)", () => {
  it("blocks a MEMBER with a permission-limited EmptyState, never calling the preview route", async () => {
    withRole("MEMBER");
    render();

    await waitFor(() => expect(screen.getByText(/restrito a OWNER e ADMIN/)).toBeInTheDocument());
    expect(postMock).not.toHaveBeenCalled();
  });

  it("an ADMIN sees the preview stage with the real scope hash and requirement count", async () => {
    withRole("ADMIN");
    mockSubjectAndPreview({ requirementCount: 3 });
    render();

    await waitFor(() => expect(screen.getByText(/Requisitos incluídos: 3/)).toBeInTheDocument());
    expect(screen.getByText(/scope_abc123/)).toBeInTheDocument();
  });

  it("a CONFLICT on confirm shows a neutral notice (never claims 'scope changed', which the backend can't actually prove) with 'Atualizar pré-visualização' instead of silently generating", async () => {
    withRole("OWNER");
    mockSubjectAndPreview();
    postMock.mockImplementation((path: string) => {
      if (path === "/document-archive/subjects/subject-1/dossier") {
        return Promise.resolve({
          run: { runId: "run-1", subjectId: "subject-1", status: "PREVIEW_READY", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" },
          rows: [],
        });
      }
      if (path === "/document-archive/subjects/subject-1/dossier/run-1/confirm") {
        return Promise.reject(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "stale", retryable: false }));
      }
      return Promise.reject(new Error(`unexpected POST path ${path}`));
    });
    render();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar e gerar" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Confirmar e gerar" }).click();

    await waitFor(() => expect(screen.getByText(/Não foi possível confirmar a geração agora/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Atualizar pré-visualização" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar e gerar" })).not.toBeInTheDocument();
  });

  it("confirming moves to the generating stage (runId in the URL), then shows 'Baixar dossiê' once the poll reports READY", async () => {
    withRole("ADMIN");
    mockSubjectAndPreview();
    let pollCount = 0;
    getMock.mockImplementation((path: string) => {
      if (path === "/subjects/subject-1") return Promise.resolve({ subject: subject() });
      if (path.startsWith("/document-archive/subjects/subject-1/dossier/run-1/download")) {
        pollCount += 1;
        if (pollCount < 2) {
          return Promise.reject(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "not ready", retryable: false, details: { status: "GENERATING" } }));
        }
        return Promise.resolve({ downloadUrl: "https://s3.example/dossier.pdf", expiresInSeconds: 300 });
      }
      return Promise.reject(new Error(`unexpected GET path ${path}`));
    });
    postMock.mockImplementation((path: string) => {
      if (path === "/document-archive/subjects/subject-1/dossier") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "PREVIEW_READY", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" }, rows: [] });
      }
      if (path === "/document-archive/subjects/subject-1/dossier/run-1/confirm") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "CONFIRMED", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" } });
      }
      return Promise.reject(new Error(`unexpected POST path ${path}`));
    });
    render();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar e gerar" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Confirmar e gerar" }).click();

    await waitFor(() => expect(screen.getByText("Gerando dossiê…")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Baixar dossiê" })).toBeInTheDocument(), { timeout: 10_000 });
  }, 15_000);

  it("shows a failure notice with 'Tentar novamente' when the run reaches FAILED", async () => {
    withRole("ADMIN");
    mockSubjectAndPreview();
    getMock.mockImplementation((path: string) => {
      if (path === "/subjects/subject-1") return Promise.resolve({ subject: subject() });
      if (path.startsWith("/document-archive/subjects/subject-1/dossier/run-1/download")) {
        return Promise.reject(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "failed", retryable: false, details: { status: "FAILED" } }));
      }
      return Promise.reject(new Error(`unexpected GET path ${path}`));
    });
    postMock.mockImplementation((path: string) => {
      if (path === "/document-archive/subjects/subject-1/dossier") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "PREVIEW_READY", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" }, rows: [] });
      }
      if (path === "/document-archive/subjects/subject-1/dossier/run-1/confirm") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "CONFIRMED", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" } });
      }
      return Promise.reject(new Error(`unexpected POST path ${path}`));
    });
    render();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar e gerar" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Confirmar e gerar" }).click();

    await waitFor(() => expect(screen.getByText("Não foi possível gerar o dossiê.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  // Codex review round finding: `retry: false` on the poll query meant a single transient
  // network/5xx failure on the FIRST poll left the screen stuck on "Gerando dossiê…" forever
  // (no data ever existed for refetchInterval's own re-arm condition). A bounded retry now
  // absorbs a transient blip; a persistent failure surfaces its own retry action.
  it("a persistently failing poll (not a real ConflictError, e.g. network down) shows a retry action instead of spinning forever", async () => {
    withRole("ADMIN");
    mockSubjectAndPreview();
    getMock.mockImplementation((path: string) => {
      if (path === "/subjects/subject-1") return Promise.resolve({ subject: subject() });
      if (path.startsWith("/document-archive/subjects/subject-1/dossier/run-1/download")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.reject(new Error(`unexpected GET path ${path}`));
    });
    postMock.mockImplementation((path: string) => {
      if (path === "/document-archive/subjects/subject-1/dossier") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "PREVIEW_READY", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" }, rows: [] });
      }
      if (path === "/document-archive/subjects/subject-1/dossier/run-1/confirm") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "CONFIRMED", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" } });
      }
      return Promise.reject(new Error(`unexpected POST path ${path}`));
    });
    render();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar e gerar" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Confirmar e gerar" }).click();

    await waitFor(() => expect(screen.getByText("Não foi possível verificar o andamento da geração agora.")).toBeInTheDocument(), { timeout: 10_000 });
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  }, 15_000);

  // Codex review round finding: a failure at the final download click (expired run, network,
  // any non-2xx) used to be swallowed by an empty catch - the button just stopped spinning with
  // no feedback at all.
  it("a download failure once READY shows a real error, not silence", async () => {
    withRole("ADMIN");
    mockSubjectAndPreview();
    let downloadCalls = 0;
    getMock.mockImplementation((path: string) => {
      if (path === "/subjects/subject-1") return Promise.resolve({ subject: subject() });
      if (path.startsWith("/document-archive/subjects/subject-1/dossier/run-1/download")) {
        downloadCalls += 1;
        // The 1st call is the poll reaching READY (a successful call IS the READY signal); the
        // 2nd is the user's own "Baixar dossiê" click, which fails for real (e.g. the run expired
        // between the poll landing and the user clicking).
        if (downloadCalls === 1) return Promise.resolve({ downloadUrl: "https://s3.example/dossier.pdf", expiresInSeconds: 300 });
        return Promise.reject(new ApiError({ code: "NOT_FOUND", category: "NOT_FOUND", message: "Este dossiê expirou.", retryable: false }));
      }
      return Promise.reject(new Error(`unexpected GET path ${path}`));
    });
    postMock.mockImplementation((path: string) => {
      if (path === "/document-archive/subjects/subject-1/dossier") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "PREVIEW_READY", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" }, rows: [] });
      }
      if (path === "/document-archive/subjects/subject-1/dossier/run-1/confirm") {
        return Promise.resolve({ run: { runId: "run-1", subjectId: "subject-1", status: "CONFIRMED", scopeHash: "scope_abc123", createdAt: "x", updatedAt: "x" } });
      }
      return Promise.reject(new Error(`unexpected POST path ${path}`));
    });
    render();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar e gerar" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Confirmar e gerar" }).click();

    await waitFor(() => expect(screen.getByRole("button", { name: "Baixar dossiê" })).toBeInTheDocument(), { timeout: 10_000 });
    screen.getByRole("button", { name: "Baixar dossiê" }).click();

    await waitFor(() => expect(screen.getByText("Este dossiê expirou.")).toBeInTheDocument());
  }, 15_000);
});
