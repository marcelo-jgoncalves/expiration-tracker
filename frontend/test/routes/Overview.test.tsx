import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { Overview } from "../../src/routes/Overview.js";
import type { DashboardSummaryResponse, ExpirationItem, StorageQuotaUsage } from "../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
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

function usage(overrides: Partial<StorageQuotaUsage>): StorageQuotaUsage {
  return {
    limitBytes: 8 * 1024 * 1024 * 1024,
    usedBytes: 0,
    reservedBytes: 0,
    availableBytes: 8 * 1024 * 1024 * 1024,
    usedPercent: 0,
    warningLevel: "OK",
    ...overrides,
  };
}

function summary(overrides: Partial<DashboardSummaryResponse>): DashboardSummaryResponse {
  return {
    overdueCount: 0,
    expiringSoonCount: 0,
    awaitingReviewCount: 0,
    missingRequirementsCount: 0,
    itemsOverdueCount: 0,
    itemsExpiringSoonCount: 0,
    activeItemsCount: 0,
    approximate: false,
    ...overrides,
  };
}

function mockGet(byPath: { items?: ExpirationItem[]; usage?: StorageQuotaUsage; summary?: DashboardSummaryResponse }) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/items/dashboard")) return Promise.resolve({ items: byPath.items ?? [] });
    if (path === "/document-archive/storage-usage") return Promise.resolve({ usage: byPath.usage ?? usage({}) });
    if (path === "/dashboard/summary") return Promise.resolve({ summary: byPath.summary ?? summary({}) });
    throw new Error(`unexpected path ${path}`);
  });
}

beforeEach(() => {
  getMock.mockReset();
});

describe("Overview", () => {
  it("lists ACTIVE items and never shows the storage card when usage is OK", async () => {
    mockGet({ items: [item({})], usage: usage({ warningLevel: "OK" }) });

    renderAtRoute("/dashboard", <Overview />, "/dashboard");

    await waitFor(() => expect(screen.getByText("Item")).toBeInTheDocument());
    expect(screen.queryByText(/Armazenamento:/)).not.toBeInTheDocument();
  });

  // A03 (D-2xx addendum): the storage card is conditional on warningLevel, independent of the
  // items table's own loading/error/success cycle - it must appear once the quota crosses 80%
  // even though the primary content above it renders normally.
  it("shows the storage card once usage crosses the WARNING threshold", async () => {
    mockGet({
      items: [item({})],
      usage: usage({ warningLevel: "WARNING", usedBytes: 7 * 1024 * 1024 * 1024, usedPercent: 0.875 }),
    });

    renderAtRoute("/dashboard", <Overview />, "/dashboard");

    await waitFor(() => expect(screen.getByText(/Armazenamento:/)).toBeInTheDocument());
    expect(screen.getByText(/88%/)).toBeInTheDocument();
  });

  it("shows the OVER-state upload-blocked notice", async () => {
    mockGet({
      items: [],
      usage: usage({ warningLevel: "OVER", usedBytes: 8 * 1024 * 1024 * 1024, usedPercent: 1 }),
    });

    renderAtRoute("/dashboard", <Overview />, "/dashboard");

    await waitFor(() => expect(screen.getByText(/Armazenamento:/)).toBeInTheDocument());
    expect(screen.getByText(/Novos uploads bloqueados/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no ACTIVE items", async () => {
    mockGet({ items: [], usage: usage({}) });

    renderAtRoute("/dashboard", <Overview />, "/dashboard");

    await waitFor(() => expect(screen.getByText(/Nenhum vencimento cadastrado ainda/)).toBeInTheDocument());
  });

  // D-308 pendência #14 (PENDING_PROTOCOL_REVIEW): mutation - reverting to the old hardcoded
  // placeholder counts (3/4/items.length) would make these assertions fail, since the mocked
  // summary here uses different, distinguishable numbers.
  it("shows the 3 attention counts from the real GET /dashboard/summary aggregate, not a placeholder", async () => {
    mockGet({
      items: [item({})],
      usage: usage({}),
      summary: summary({ itemsOverdueCount: 7, itemsExpiringSoonCount: 5, activeItemsCount: 42 }),
    });

    renderAtRoute("/dashboard", <Overview />, "/dashboard");

    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
    expect(screen.getByText("vencidos")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("vencem em 7 dias")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("em acompanhamento")).toBeInTheDocument();
  });

  // Mutation: removing the `attention ? <AttentionRow /> : <InlineNotice />` fallback (or making
  // `summaryQuery.isError` render nothing) would either crash rendering `undefined` counts or
  // silently show no feedback at all - this asserts the degraded state is visible, not silent.
  it("degrades gracefully (never blocks the items table) when the summary aggregate fails", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/items/dashboard")) return Promise.resolve({ items: [item({})] });
      if (path === "/document-archive/storage-usage") return Promise.resolve({ usage: usage({}) });
      if (path === "/dashboard/summary") return Promise.reject(new Error("boom"));
      throw new Error(`unexpected path ${path}`);
    });

    renderAtRoute("/dashboard", <Overview />, "/dashboard");

    await waitFor(() => expect(screen.getByText("Item")).toBeInTheDocument());
    expect(screen.getByText(/Não foi possível carregar os contadores de atenção/)).toBeInTheDocument();
  });
});
