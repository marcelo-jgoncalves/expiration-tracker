import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { ActivityLog } from "../../src/routes/ActivityLog.js";
import type { ActivityEntry } from "../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    auditEventId: "evt-1",
    partition: "expiration",
    occurredAt: "2026-09-10T12:00:00.000Z",
    actor: { type: "USER", userId: "user-1" },
    action: "CREATE",
    resourceType: "ExpirationItem",
    resourceId: "item-1",
    changes: {},
    ...overrides,
  };
}

beforeEach(() => {
  getMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("ActivityLog (D-149)", () => {
  it("blocks a VIEWER with a permission-limited message, never calling GET /activity", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "VIEWER", version: 1 }] });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument());
    expect(getMock).not.toHaveBeenCalled();
  });

  it("renders the feed as a DataTable (action in <code>, never raw JSON) for an ADMIN", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({
      entries: [entry({ auditEventId: "evt-1", action: "CREATE", resourceType: "ExpirationItem", resourceId: "item-1" })],
      cursor: null,
      hasMore: false,
    });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText("CREATE").tagName).toBe("CODE"));
    expect(screen.getByText("ExpirationItem — item-1")).toBeInTheDocument();
    expect(screen.queryByText(/{.*}/)).not.toBeInTheDocument();
  });

  it("shows 'Usuário não identificado' for a USER actor with no userId (never claims a specific unproven cause)", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({ entries: [entry({ actor: { type: "USER" } })], cursor: null, hasMore: false });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText("Usuário não identificado")).toBeInTheDocument());
  });

  it("shows 'Todos os eventos foram carregados.' once hasMore is false and there are entries", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({ entries: [entry({})], cursor: null, hasMore: false });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText("Todos os eventos foram carregados.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  // Codex review round (Block 10) finding: TanStack Query v5 sets the infinite query's overall
  // `isError` on a `fetchNextPage()` failure too, while still preserving already-loaded `data` -
  // this used to be checked with a plain `query.isError`, blanking the whole table on a
  // next-page failure. Now only a genuine INITIAL-load failure does that.
  it("a fetchNextPage() failure keeps every already-loaded row visible and shows an inline retry, never blanking the table", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    let call = 0;
    getMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ entries: [entry({ auditEventId: "evt-1" })], cursor: "next-1", hasMore: true });
      return Promise.reject(new Error("down"));
    });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByRole("button", { name: "Carregar mais" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Carregar mais" }).click();

    await waitFor(() => expect(screen.getByText("Não foi possível carregar mais eventos.")).toBeInTheDocument());
    expect(screen.getByText("CREATE")).toBeInTheDocument();
  });

  it("shows a 'Carregar mais' button when hasMore is true, and fetches the next page via the returned cursor on click", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockImplementation((path: string) => {
      if (path.includes("cursor=next-1")) {
        return Promise.resolve({ entries: [entry({ auditEventId: "evt-2" })], cursor: null, hasMore: false });
      }
      return Promise.resolve({ entries: [entry({ auditEventId: "evt-1" })], cursor: "next-1", hasMore: true });
    });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByRole("button", { name: "Carregar mais" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Carregar mais" }).click();

    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining("cursor=next-1"), expect.anything()));
  });

  it("shows an empty state when there are no events", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({ entries: [], cursor: null, hasMore: false });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText("Nenhum evento registrado ainda.")).toBeInTheDocument());
  });
});
