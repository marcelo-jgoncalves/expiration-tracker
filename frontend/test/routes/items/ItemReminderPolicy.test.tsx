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

  it("Codex review finding (D-258 round 1): an empty or decimal offset is rejected inline, never silently coerced to 0 ('No dia') or sent as an invalid offsetIso", async () => {
    mockItemAndPolicy({}, policy({}));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar aviso" }));
    fireEvent.change(screen.getByLabelText("Número de dias antes"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByText("Informe um número inteiro de dias maior que zero.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Número de dias antes"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByText("Informe um número inteiro de dias maior que zero.")).toBeInTheDocument();
    // Neither invalid attempt added a new trigger row - still just the original "-P7D" one.
    expect(screen.getAllByText(/dias antes|No dia/).filter((el) => el.tagName === "SPAN")).toHaveLength(1);
  });

  it("Codex review finding (D-258 round 1): AUTHORIZATION on the policy query maps to the permission-limited state, not a generic retryable error", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/reminder-policy") return Promise.reject(new ApiError({ code: "FORBIDDEN", category: "AUTHORIZATION", message: "forbidden", retryable: false }, 403));
      return Promise.reject(new Error("unexpected path " + path));
    });
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText("Acesso restrito")).toBeInTheDocument());
  });

  it("Codex review finding (D-258 round 1): a successful save writes the response into the cache synchronously - an immediate second save on the same edit dispatches PUT (update), never a duplicate POST", async () => {
    // A real backend would echo the just-created policy on the next GET; this mock mirrors
    // that (rather than staying pinned to the pre-create `null`) so the test isolates the
    // synchronous-cache-write fix from `invalidateQueries`' own eventual-consistency refetch.
    let created: ReminderPolicy | null = null;
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-1") return Promise.resolve({ item: item({}) });
      if (path === "/items/item-1/reminder-policy") return Promise.resolve({ policy: created });
      return Promise.reject(new Error("unexpected path " + path));
    });
    postMock.mockImplementation(() => {
      created = policy({ policyId: "policy-new", version: 1 });
      return Promise.resolve({ policy: created });
    });
    putMock.mockResolvedValue({ policy: policy({ policyId: "policy-new", version: 2 }) });
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText("Nenhum aviso configurado")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar aviso" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));

    // A second, independent edit immediately after the first save's response lands - before
    // any real network round-trip for the refetch has necessarily settled.
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));

    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/reminders/policies/policy-new", expect.anything(), { expectedVersion: 1 }));
    expect(postMock).toHaveBeenCalledTimes(1);
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

  it("an OCC conflict on save (409) shows the conflict notice and re-fetches the current version (Codex review finding: a stale If-Match must not be resent forever)", async () => {
    mockItemAndPolicy({}, policy({ version: 2 }));
    const { ApiError } = await import("../../../src/api/errors.js");
    putMock.mockRejectedValue(new ApiError({ code: "VERSION_CONFLICT", category: "CONFLICT", message: "conflict", retryable: false }, 409));
    mockAsRole("OWNER");
    renderAtRoute("/items/:itemId/reminder-policy", <ItemReminderPolicy />, "/items/item-1/reminder-policy");

    await waitFor(() => expect(screen.getByText(/7 dias antes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch"));
    getMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembretes" }));

    await waitFor(() => expect(screen.getByText("Esta política foi alterada por outra pessoa. Revise antes de salvar novamente.")).toBeInTheDocument());
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/items/item-1/reminder-policy", expect.anything()));
    // The user's in-progress edit (the toggle they just flipped) survives the refetch intact.
    expect(screen.getByText("Esta política está desabilitada — nenhum aviso será enviado.")).toBeInTheDocument();
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
