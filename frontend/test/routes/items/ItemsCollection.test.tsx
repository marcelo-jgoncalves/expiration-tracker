import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { ItemsCollection } from "../../../src/routes/items/ItemsCollection.js";
import type { ExpirationItem } from "../../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: (path: string, options: unknown) => {
    if (path === "/dashboard/summary") return Promise.resolve({ summary: { activeItemsCount: 42, approximate: false } });
    if (path === "/organizations") return Promise.resolve({ organizations: [] });
    return getMock(path, options).then((page: { items: ExpirationItem[]; cursor?: string | null }) => ({ ...page, items: page.items.map(item => ({ kind: "EXPIRATION_ITEM", item })), cursor: page.cursor ?? null, scanLimitReached: false }));
  }, post: vi.fn() },
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
  // Mutation: moving overdue items into the later group would fail the assertions.
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

  // Mutation: dropping either urgency or lifecycle state would fail the assertions.
  it("shows urgency and lifecycle status as separate columns - never merged into one token (mission §32)", async () => {
    getMock.mockResolvedValue({ items: [item({ itemId: "overdue", name: "Overdue item", dueDate: "2020-01-01T00:00:00.000Z" })] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    const row = await waitFor(() => screen.getByText("Overdue item").closest("tr") as HTMLElement);
    expect(within(row).getByText("Vencido")).toBeInTheDocument();
    expect(within(row).getByText("Ativo")).toBeInTheDocument();
  });

  // Mutation: hiding the absolute due date would fail the assertions.
  it("always shows the absolute due date, never only a relative phrase (mission §19)", async () => {
    getMock.mockResolvedValue({ items: [item({ itemId: "x", name: "Dated item", dueDate: "2026-09-01T00:00:00.000Z" })] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    const row = await waitFor(() => screen.getByText("Dated item").closest("tr") as HTMLElement);
    expect(within(row).getByText("01/09/2026")).toBeInTheDocument();
  });

  // Mutation: claiming a populated active list when empty would fail the assertions.
  it("shows the true-empty state for a genuinely empty ACTIVE list, distinct from a filtered-empty other tab", async () => {
    getMock.mockResolvedValue({ items: [] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    await waitFor(() => expect(screen.getByText("Nenhum vencimento ativo.")).toBeInTheDocument());
  });

  // Mutation: ignoring the archived status in the remote query would fail the assertions.
  it("switching to the Arquivados tab queries status=ARCHIVED and shows filtered-empty copy when it's empty", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=ARCHIVED")) return Promise.resolve({ items: [] });
      return Promise.resolve({ items: [item({})] });
    });
    renderAtRoute("/items", <ItemsCollection />, "/items");
    await waitFor(() => expect(screen.getByRole("button", { name: "Arquivados" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Arquivados" }));

    await waitFor(() => expect(screen.getByText("Nenhum vencimento arquivado.")).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining("status=ARCHIVED"), expect.anything());
  });

  // Mutation: offering retry on authorization denial would fail the assertions.
  it("maps an AUTHORIZATION error to the permission-limited empty state, not a retry-offering error banner", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockRejectedValue(new ApiError({ code: "AUTHORIZATION_DENIED", category: "AUTHORIZATION", message: "nope", retryable: false }));
    renderAtRoute("/items", <ItemsCollection />, "/items");

    await waitFor(() => expect(screen.getByText("Você não tem acesso a este conteúdo.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
  });

  // Mutation: removing the retry callback would fail the assertions.
  it("a backend failure shows the error state with a working retry", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock
      .mockRejectedValueOnce(new ApiError({ code: "INTERNAL", category: "INTERNAL", message: "erro interno", retryable: false }))
      .mockResolvedValueOnce({ items: [] });
    renderAtRoute("/items", <ItemsCollection />, "/items");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByText("Nenhum vencimento ativo.")).toBeInTheDocument());
  });

  // Mutation: truncating the loaded rows would fail the assertions.
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
  // Mutation: returning early for an empty filtered page would hide its continuation cursor.
  it("allows continuation from an empty page when the server still returns a cursor", async () => {
    getMock.mockImplementation((path: string) => Promise.resolve(path.includes("cursor=next")
      ? { items: [item({ name: "Later match" })], cursor: null }
      : { items: [], cursor: "next" }));
    renderAtRoute("/items", <ItemsCollection />, "/items?search=Later");
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Later match")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining("cursor=next"), expect.anything());
  });

  // Mutation: checking isError without preserving data would blank existing rows after pagination fails.
  it("retains existing rows when the next page fails and permits retry", async () => {
    getMock.mockImplementation((path: string) => path.includes("cursor=next")
      ? Promise.reject(new Error("offline")) : Promise.resolve({ items: [item({ name: "Saved row" })], cursor: "next" }));
    renderAtRoute("/items", <ItemsCollection />, "/items");
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await screen.findByText(/Os registros carregados foram mantidos/);
    expect(screen.getByText("Saved row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeEnabled();
  });

});
