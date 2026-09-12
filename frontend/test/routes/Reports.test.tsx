import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { Reports } from "../../src/routes/Reports.js";
import { ToastProvider } from "../../src/components/Toast.js";
import type { ReportSubscription } from "../../src/api/types.js";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, put: vi.fn(), delete: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function withRole(role: string) {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

function subscription(overrides: Partial<ReportSubscription> = {}): ReportSubscription {
  return {
    subscriptionId: "sub-1",
    reportTypes: ["MISSING_REQUIREMENTS"],
    dayOfWeek: 1,
    localTime: "08:00",
    timeZone: "America/Sao_Paulo",
    recipientUserIds: ["user-1"],
    nextRunAt: "2026-09-15T11:00:00.000Z",
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function render() {
  return renderAtRoute("/reports", <ToastProvider><Reports /></ToastProvider>, "/reports");
}

function mockFetchResponse(init: { ok: boolean; status?: number; headers?: Record<string, string>; body?: unknown }) {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
    blob: () => Promise.resolve(new Blob(["csv,data"])),
    json: () => Promise.resolve(init.body ?? {}),
  };
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  fetchOrganizationsMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  if (!("createObjectURL" in URL)) Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), configurable: true });
  if (!("revokeObjectURL" in URL)) Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("Reports (A16, Block 10)", () => {
  it("blocks a MEMBER with a permission-limited EmptyState, never calling GET /reports/subscriptions", async () => {
    withRole("MEMBER");
    render();

    await waitFor(() => expect(screen.getByText(/administrados por OWNER\/ADMIN/)).toBeInTheDocument());
    expect(getMock).not.toHaveBeenCalledWith("/reports/subscriptions", expect.anything());
  });

  // Codex review round finding: while `role` is still resolving, this screen used to render the
  // full catalog (every "Baixar CSV" button already clickable) before the permission gate above
  // had a real answer - a MEMBER/VIEWER on a slow role fetch could briefly see and click an
  // admin-only control. Default-deny: no catalog button exists until role actually resolves.
  it("shows a neutral skeleton (never the catalog) while the role is still resolving", async () => {
    let resolveOrganizations: (() => void) | undefined;
    fetchOrganizationsMock.mockReturnValue(new Promise((resolve) => (resolveOrganizations = () => resolve({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] }))));
    getMock.mockResolvedValue({ subscriptions: [] });
    render();

    expect(screen.queryByRole("button", { name: "Baixar CSV" })).not.toBeInTheDocument();
    resolveOrganizations?.();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Baixar CSV" })).toHaveLength(7));
  });

  it("renders the 7 report cards grouped under Vencimentos/Requisitos for an ADMIN", async () => {
    withRole("ADMIN");
    getMock.mockResolvedValue({ subscriptions: [] });
    render();

    await waitFor(() => expect(screen.getByText("Vencimentos expirados")).toBeInTheDocument());
    expect(screen.getByText("Requisitos por responsável")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Baixar CSV" })).toHaveLength(7);
  });

  it("downloads a report CSV and shows the truncated notice when x-report-truncated is present", async () => {
    withRole("ADMIN");
    getMock.mockResolvedValue({ subscriptions: [] });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockFetchResponse({ ok: true, headers: { "x-report-truncated": "1" } }));
    render();

    await waitFor(() => expect(screen.getByText("Vencimentos expirados")).toBeInTheDocument());
    screen.getAllByRole("button", { name: "Baixar CSV" })[0]?.click();

    await waitFor(() => expect(screen.getByText(/foi truncado/)).toBeInTheDocument());
  });

  it("shows an inline error on the specific card when a report download fails, without blocking the other cards", async () => {
    withRole("ADMIN");
    getMock.mockResolvedValue({ subscriptions: [] });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockFetchResponse({ ok: false, status: 500, body: { code: "INTERNAL", category: "INTERNAL", message: "Não foi possível gerar este relatório agora.", retryable: false } }),
    );
    render();

    await waitFor(() => expect(screen.getByText("Vencimentos expirados")).toBeInTheDocument());
    screen.getAllByRole("button", { name: "Baixar CSV" })[0]?.click();

    await waitFor(() => expect(screen.getByText("Não foi possível gerar este relatório agora.")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "Baixar CSV" })).toHaveLength(7);
  });

  it("shows the empty state with a 'Nova assinatura' action when there are no subscriptions", async () => {
    withRole("ADMIN");
    getMock.mockResolvedValue({ subscriptions: [] });
    render();

    await waitFor(() => expect(screen.getByText(/Nenhuma assinatura configurada/)).toBeInTheDocument());
  });

  it("lists an existing subscription showing the real report set, weekly schedule, and nextRunAt (never a fabricated 'última execução')", async () => {
    withRole("ADMIN");
    getMock.mockResolvedValue({ subscriptions: [subscription()] });
    render();

    await waitFor(() => expect(screen.getByText(/Semanal · Segunda 08:00/)).toBeInTheDocument());
    expect(screen.getByText("1 destinatário(s)")).toBeInTheDocument();
    expect(screen.queryByText(/última execução/i)).not.toBeInTheDocument();
  });

  it("creates a subscription with the selected reports/day/time/recipients", async () => {
    withRole("ADMIN");
    getMock.mockImplementation((path: string) => {
      if (path === "/reports/subscriptions") return Promise.resolve({ subscriptions: [] });
      if (path === "/organizations/members") return Promise.resolve({ members: [{ userId: "user-1", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", version: 1 }] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    postMock.mockResolvedValue({ subscription: subscription() });
    render();

    await waitFor(() => expect(screen.getByRole("button", { name: "Nova assinatura" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Nova assinatura" }).click();

    await waitFor(() => expect(screen.getByLabelText("Requisitos em falta")).toBeInTheDocument());
    screen.getByLabelText("Requisitos em falta").click();
    await waitFor(() => expect(screen.getByLabelText("user-1")).toBeInTheDocument());
    screen.getByLabelText("user-1").click();
    screen.getByRole("button", { name: "Salvar" }).click();

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/reports/subscriptions", {
        reportTypes: ["MISSING_REQUIREMENTS"],
        dayOfWeek: 1,
        localTime: "08:00",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recipientUserIds: ["user-1"],
      }),
    );
  });

  it("shows the OCC-conflict message (never the generic error) when removing a subscription races a concurrent change", async () => {
    withRole("ADMIN");
    getMock.mockResolvedValue({ subscriptions: [subscription()] });
    const { ApiError } = await import("../../src/api/errors.js");
    postMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "conflict", retryable: false }));
    render();

    await waitFor(() => expect(screen.getByRole("button", { name: "Remover" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Remover" }).click();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar remoção" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Confirmar remoção" }).click();

    await waitFor(() => expect(screen.getByText(/alterada por outra pessoa/)).toBeInTheDocument());
  });
});
