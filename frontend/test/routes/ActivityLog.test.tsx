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

  it("renders the feed as prose lines (never raw JSON) for an ADMIN", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({
      entries: [entry({ auditEventId: "evt-1", action: "CREATE", resourceType: "ExpirationItem", resourceId: "item-1" })],
      cursor: null,
      hasMore: false,
    });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText(/CREATE/)).toBeInTheDocument());
    expect(screen.getByText(/ExpirationItem item-1/)).toBeInTheDocument();
    expect(screen.queryByText(/{.*}/)).not.toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByText(/Nenhum evento de atividade/)).toBeInTheDocument());
  });
});
