import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { ItemsCollection } from "../../../src/routes/items/ItemsCollection.js";
import type { ExpirationItem } from "../../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}));

function item(overrides: Partial<ExpirationItem>): ExpirationItem {
  return {
    itemId: "item-1",
    tenantId: "t1",
    name: "Item",
    category: "Cat",
    dueDate: "2026-09-01T00:00:00.000Z",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  getMock.mockReset();
});

describe("ItemsCollection", () => {
  it("shows initial loading, then groups ACTIVE items by urgency (Vencidos/Vence em breve/Demais ativos), most urgent first", async () => {
    getMock.mockResolvedValue({
      items: [
        item({ itemId: "later", name: "Later item", dueDate: "2026-12-01T00:00:00.000Z" }),
        item({ itemId: "overdue", name: "Overdue item", dueDate: "2020-01-01T00:00:00.000Z" }),
        item({ itemId: "soon", name: "Soon item", dueDate: new Date(Date.now() + 2 * 86400000).toISOString() }),
      ],
    });

    renderAtRoute("/items", <ItemsCollection />, "/items");

    expect(screen.getByText("Carregando vencimentos…")).toBeInTheDocument();
    // Groups are real table row groups now (a <th scope="rowgroup"> heading each <tbody>),
    // not <section>/<h2> around separate lists - see ItemsCollection.tsx's header comment.
    await waitFor(() => expect(screen.getByRole("rowheader", { name: /Vencidos/ })).toBeInTheDocument());

    expect(screen.getByRole("rowheader", { name: /Vence em breve/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Demais ativos/ })).toBeInTheDocument();

    const overdueGroup = screen.getByRole("rowheader", { name: /Vencidos/ }).closest("tbody") as HTMLElement;
    expect(within(overdueGroup).getByText("Overdue item")).toBeInTheDocument();
    expect(within(overdueGroup).queryByText("Later item")).not.toBeInTheDocument();
  });

  it("shows urgency and lifecycle status as separate columns - never merged into one token (mission §32)", async () => {
    getMock.mockResolvedValue({ items: [item({ itemId: "overdue", name: "Overdue item", dueDate: "2020-01-01T00:00:00.000Z" })] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    const row = await waitFor(() => screen.getByText("Overdue item").closest("tr") as HTMLElement);
    expect(within(row).getByText("Vencido")).toBeInTheDocument();
    expect(within(row).getByText("Ativo")).toBeInTheDocument();
  });

  it("always shows the absolute due date, never only a relative phrase (mission §19)", async () => {
    getMock.mockResolvedValue({ items: [item({ itemId: "x", name: "Dated item", dueDate: "2026-09-01T00:00:00.000Z" })] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    const row = await waitFor(() => screen.getByText("Dated item").closest("tr") as HTMLElement);
    expect(within(row).getByText("01/09/2026")).toBeInTheDocument();
  });

  it("shows the true-empty state for a genuinely empty ACTIVE list, distinct from a filtered-empty other tab", async () => {
    getMock.mockResolvedValue({ items: [] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    await waitFor(() => expect(screen.getByText("Nenhum vencimento cadastrado ainda.")).toBeInTheDocument());
  });

  it("switching to the Arquivados tab queries status=ARCHIVED and shows filtered-empty copy when it's empty", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=ARCHIVED")) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [item({})] });
    });
    renderAtRoute("/items", <ItemsCollection />, "/items");
    await waitFor(() => expect(screen.getByRole("button", { name: "Arquivados" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Arquivados" }));

    await waitFor(() => expect(screen.getByText("Nenhum vencimento neste status.")).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining("status=ARCHIVED"), expect.anything());
  });

  it("maps an AUTHORIZATION error to the permission-limited empty state, not a retry-offering error banner", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockRejectedValue(new ApiError({ code: "AUTHORIZATION_DENIED", category: "AUTHORIZATION", message: "nope", retryable: false }));
    renderAtRoute("/items", <ItemsCollection />, "/items");

    await waitFor(() => expect(screen.getByText("Você não tem acesso a este conteúdo.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
  });

  it("a backend failure shows the error state with a working retry", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock
      .mockRejectedValueOnce(new ApiError({ code: "INTERNAL", category: "INTERNAL", message: "erro interno", retryable: false }))
      .mockResolvedValueOnce({ items: [] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByText("Nenhum vencimento cadastrado ainda.")).toBeInTheDocument());
  });

  it("renders correctly with a dense dataset (150 active items) without error - density validation (mission §67)", async () => {
    const items = Array.from({ length: 150 }, (_, i) =>
      item({ itemId: `item-${i}`, name: `Item ${i}`, dueDate: new Date(Date.now() + i * 86400000).toISOString() }),
    );
    getMock.mockResolvedValue({ items });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    // 150 data rows + 1 column-header row + 1 group-header row per non-empty urgency group.
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(151));
    expect(screen.getAllByRole("row").filter((row) => row.querySelector("td.ui-table__cell--primary") !== null)).toHaveLength(150);
  });
});
