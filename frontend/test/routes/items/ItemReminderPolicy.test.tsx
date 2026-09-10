import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { ItemReminderPolicy } from "../../../src/routes/items/ItemReminderPolicy.js";
import type { ExpirationItem, MembershipRole, ReminderPolicy } from "../../../src/api/types.js";

const { getMock, postMock, putMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
}));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, put: putMock },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function item(overrides: Partial<ExpirationItem>): ExpirationItem {
  return {
    itemId: "item-1",
    tenantId: "t1",
    name: "Apólice de Seguro",
    category: "Financeiro",
    dueDate: "2026-09-13T00:00:00.000Z",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

function policy(overrides: Partial<ReminderPolicy>): ReminderPolicy {
  return {
    policyId: "policy-1",
    tenantId: "t1",
    scope: "ITEM",
    itemId: "item-1",
    name: "Apólice de Seguro",
    triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }],
    timeZone: "America/Sao_Paulo",
    channels: ["EMAIL"],
    enabled: true,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockAsRole(role: MembershipRole) {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

function mockItemAndPolicy(itemOverrides: Partial<ExpirationItem>, policyValue: ReminderPolicy | null) {
  getMock.mockImplementation((path: string) => {
    if (path === "/items/item-1") return Promise.resolve({ item: item(itemOverrides) });
    if (path === "/items/item-1/reminder-policy") return Promise.resolve({ policy: policyValue });
    return Promise.reject(new Error("unexpected path " + path));
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  putMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("ItemReminderPolicy (A06)", () => {
  it("every role can view the policy (reminder:manage view is available to VIEWER as read-only)", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as MembershipRole[]) {
      mockItemAndPolicy({}, policy({}));
      mockAsRole(role);
      const { unmount } = renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");
      await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
      unmount();
    }
  });

  it("VIEWER sees the read-only render, never Salvar/Remover/the toggle", async () => {
    mockItemAndPolicy({}, policy({}));
    mockAsRole("VIEWER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Salvar lembretes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remover/ })).not.toBeInTheDocument();
  });

  it("no-policy-yet state: MEMBER sees the empty state, not a fabricated policy", async () => {
    mockItemAndPolicy({}, null);
    mockAsRole("MEMBER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText("Nenhum aviso configurado")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salvar lembretes" })).toBeDisabled();
  });

  it("creates a policy (POST) on first save when there was none yet", async () => {
    mockItemAndPolicy({}, null);
    postMock.mockResolvedValue({ policy: policy({}) });
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText("Nenhum aviso configurado")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar aviso" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/reminders/policies", expect.objectContaining({ scope: "ITEM", itemId: "item-1" }), expect.anything()));
    expect(putMock).not.toHaveBeenCalled();
  });

  it("updates the existing policy (PUT with If-Match) on subsequent saves, never POST", async () => {
    mockItemAndPolicy({}, policy({ version: 4 }));
    putMock.mockResolvedValue({ policy: policy({ version: 5 }) });
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Remover/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));

    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/reminders/policies/policy-1", expect.objectContaining({ scope: "ITEM" }), { expectedVersion: 4 }));
    expect(postMock).not.toHaveBeenCalled();
  });

  it("duplicate offset is blocked inline and never reaches save", async () => {
    mockItemAndPolicy({}, policy({}));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar aviso" }));
    fireEvent.change(screen.getByLabelText("Número de dias antes"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(screen.getByText("Este aviso já existe")).toBeInTheDocument();
  });

  it("disabling the policy (toggle off) shows the warning notice and preserves the configured triggers", async () => {
    mockItemAndPolicy({}, policy({}));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText("Esta política está desabilitada — nenhum aviso será enviado.")).toBeInTheDocument();
    expect(screen.getByText(/7 dias antes/)).toBeInTheDocument();
  });

  it("an OCC conflict on save (409) shows the conflict notice", async () => {
    mockItemAndPolicy({}, policy({ version: 2 }));
    const { ApiError } = await import("../../../src/api/errors.js");
    putMock.mockRejectedValue(new ApiError({ code: "VERSION_CONFLICT", category: "CONFLICT", message: "conflict", retryable: false }, 409));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));

    await waitFor(() => expect(screen.getByText("Esta política foi alterada por outra pessoa. Revise antes de salvar novamente.")).toBeInTheDocument());
  });

  it("a scheduler-dependency-unavailable save (503) shows the degraded-but-saved warning, not a generic failure", async () => {
    mockItemAndPolicy({}, policy({ version: 2 }));
    const { ApiError } = await import("../../../src/api/errors.js");
    putMock.mockRejectedValue(new ApiError({ code: "SCHEDULER_UNAVAILABLE", category: "DEPENDENCY_UNAVAILABLE", message: "unavailable", retryable: true }, 503));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));

    await waitFor(() =>
      expect(screen.getByText("Não foi possível confirmar o agendamento agora. Suas alterações foram salvas e serão aplicadas assim que o serviço voltar.")).toBeInTheDocument(),
    );
  });

  it("a generic save failure keeps the user's edited values on screen (never discards the edit)", async () => {
    mockItemAndPolicy({}, policy({ version: 2 }));
    putMock.mockRejectedValue(new Error("network down"));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));

    await waitFor(() => expect(screen.getByText("Não foi possível salvar. Tente novamente.")).toBeInTheDocument());
    expect(screen.getByText(/7 dias antes/)).toBeInTheDocument();
  });

  it("WhatsApp is always shown as Indisponível, never an interactive toggle", async () => {
    mockItemAndPolicy({}, policy({}));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText("WhatsApp")).toBeInTheDocument());
    expect(screen.getByText("Indisponível")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /WhatsApp/ })).not.toBeInTheDocument();
  });
});
