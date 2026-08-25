import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { ItemDetail } from "../../../src/routes/items/ItemDetail.js";
import type { ExpirationItem } from "../../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}));

function item(overrides: Partial<ExpirationItem>): ExpirationItem {
  return {
    itemId: "item-1",
    tenantId: "t1",
    name: "Apólice de Seguro",
    category: "Financeiro",
    dueDate: "2026-09-01T00:00:00.000Z",
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
});

describe("ItemDetail", () => {
  it("renders the item's fields and a Renovar link when it's ACTIVE", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    renderAtRoute("/items/:itemId", <ItemDetail />, "/items/item-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Apólice de Seguro" })).toBeInTheDocument());
    expect(screen.getByText("Financeiro")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Renovar" })).toHaveAttribute("href", "/items/item-1/renew");
  });

  it("never shows a Renovar link for a non-ACTIVE item", async () => {
    getMock.mockResolvedValue({ item: item({ status: "RENEWED" }) });
    renderAtRoute("/items/:itemId", <ItemDetail />, "/items/item-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Apólice de Seguro" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Renovar" })).not.toBeInTheDocument();
  });

  it("never mentions Documents at all - BLOCKER-A means there is no real contract to back a claim either way (mission §25)", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    renderAtRoute("/items/:itemId", <ItemDetail />, "/items/item-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Apólice de Seguro" })).toBeInTheDocument());
    expect(screen.queryByText(/documento/i)).not.toBeInTheDocument();
  });

  it("shows a single-hop renewal lineage link when renewedFromId is present and resolvable", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/items/item-2") return Promise.resolve({ item: item({ itemId: "item-2", name: "New cycle", renewedFromId: "item-1" }) });
      if (path === "/items/item-1") return Promise.resolve({ item: item({ itemId: "item-1", name: "Old cycle", dueDate: "2025-09-01T00:00:00.000Z" }) });
      return Promise.reject(new Error("unexpected path " + path));
    });
    renderAtRoute("/items/:itemId", <ItemDetail />, "/items/item-2");

    await waitFor(() => expect(screen.getByText(/Ciclo anterior/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Old cycle/ })).toHaveAttribute("href", "/items/item-1");
  });

  it("a 404 shows an honest not-found state with a way back, not a generic error", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockRejectedValue(new ApiError({ code: "NOT_FOUND", category: "NOT_FOUND", message: "not found", retryable: false }));
    renderAtRoute("/items/:itemId", <ItemDetail />, "/items/missing");

    await waitFor(() => expect(screen.getByText("Este vencimento não foi encontrado.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Voltar para Vencimentos" })).toBeInTheDocument();
  });

  it("shows the just-created confirmation banner when navigated to with justCreated state", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    renderAtRoute("/items/:itemId", <ItemDetail />, { pathname: "/items/item-1", state: { justCreated: true } });

    await waitFor(() => expect(screen.getByText("Vencimento criado com sucesso.")).toBeInTheDocument());
  });

  it("shows the just-renewed confirmation banner when navigated to with justRenewed state", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    renderAtRoute("/items/:itemId", <ItemDetail />, { pathname: "/items/item-1", state: { justRenewed: true } });

    await waitFor(() => expect(screen.getByText("Renovação concluída - este é o novo ciclo.")).toBeInTheDocument());
  });

  it("shows the copied-reminders notice when the renewal copied a policy (reminder-delivery-pipeline.md §8)", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    renderAtRoute("/items/:itemId", <ItemDetail />, { pathname: "/items/item-1", state: { justRenewed: true, copiedReminderPolicyIds: ["policy-1"] } });

    await waitFor(() => expect(screen.getByText(/Os lembretes do ciclo anterior foram copiados/)).toBeInTheDocument());
  });

  it("does not show the copied-reminders notice when nothing was copied", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    renderAtRoute("/items/:itemId", <ItemDetail />, { pathname: "/items/item-1", state: { justRenewed: true, copiedReminderPolicyIds: [] } });

    await waitFor(() => expect(screen.getByText("Renovação concluída - este é o novo ciclo.")).toBeInTheDocument());
    expect(screen.queryByText(/Os lembretes do ciclo anterior foram copiados/)).not.toBeInTheDocument();
  });
});
