import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { Overview } from "../../src/routes/Overview.js";
import type { ExpirationItem, StorageQuotaUsage } from "../../src/api/types.js";

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

function mockGet(byPath: { items?: ExpirationItem[]; usage?: StorageQuotaUsage }) {
  getMock.mockImplementation((path: string) => {
    if (path.startsWith("/items/dashboard")) return Promise.resolve({ items: byPath.items ?? [] });
    if (path === "/document-archive/storage-usage") return Promise.resolve({ usage: byPath.usage ?? usage({}) });
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
});
