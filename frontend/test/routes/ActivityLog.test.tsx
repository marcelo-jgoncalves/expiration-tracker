import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { ActivityLog } from "../../src/routes/ActivityLog.js";
import type { ActivityEntry } from "../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: (path: string, options: unknown) => path === "/organizations/members" ? Promise.resolve({ members: [] }) : getMock(path, options), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
  // Mutation: fetching activity as a viewer would fail this case.
  it("blocks a VIEWER with a permission-limited message, never calling GET /activity", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "VIEWER", version: 1 }] });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument());
    expect(getMock).not.toHaveBeenCalled();
  });

  // Mutation: exposing raw action codes instead of localized actions would fail this case.
  it("renders the feed as a DataTable (action in <code>, never raw JSON) for an ADMIN", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({
      entries: [entry({ auditEventId: "evt-1", action: "CREATE", resourceType: "ExpirationItem", resourceId: "item-1" })],
      cursor: null,
      hasMore: false,
    });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText("Criou vencimento")).toBeInTheDocument());
    // Resource renders as two lines (type + id), not one combined string (Marcelo 2026-09-22,
    // protótipo `expiration-tracker-log-atividade(1).html` restructure) - would fail if the
    // resource cell collapsed back to a single "ExpirationItem — item-1" text node.
    expect(screen.getByText("Vencimento", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("item-1")).toBeInTheDocument();
    expect(screen.queryByText(/{.*}/)).not.toBeInTheDocument();
  });

  // Mutation: inventing a missing actor identity would fail this case.
  it("shows 'Usuário não disponível' for a USER actor with no userId (never claims a specific unproven cause)", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({ entries: [entry({ actor: { type: "USER" } })], cursor: null, hasMore: false });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText("Usuário não disponível")).toBeInTheDocument());
  });

  // Mutation: offering another page without a cursor would fail this case.
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
  // Mutation: discarding loaded rows on a next-page error would fail this case.
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
    expect(screen.getByText("Criou vencimento")).toBeInTheDocument();
  });

  // Mutation: ignoring the returned cursor would fail this case.
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

  // Marcelo 2026-09-22 (protótipo `expiration-tracker-log-atividade(1).html`): filters used to
  // re-fetch on every keystroke (no debounce) - now deferred to an explicit "Aplicar filtros".
  // Would fail if a filter input still fired GET /activity on every change.
  // Mutation: applying draft filters before submission would fail this case.
  it("does not re-fetch while typing a filter, only on 'Aplicar filtros'", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({ entries: [entry({})], cursor: null, hasMore: false });

    renderAtRoute("/activity", <ActivityLog />, "/activity");
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));

    fireEvent.change(await screen.findByLabelText(/Tipo de recurso/), { target: { value: "ExpirationItem" } });
    expect(getMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(getMock.mock.calls[1]?.[0]).toContain("resourceType=ExpirationItem");
  });

  // Would fail if "Limpar" only reset the visible inputs without also re-applying the query
  // (a stale filter would keep silently narrowing the feed after the user asked to clear it).
  // Mutation: retaining an applied resource filter after clearing would fail this case.
  it("'Limpar' resets both the inputs and the applied filter", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockImplementation((path: string) =>
      Promise.resolve({
        entries: [entry({ resourceId: path.includes("resourceType=") ? "item-filtered" : "item-unfiltered" })],
        cursor: null,
        hasMore: false,
      }),
    );

    renderAtRoute("/activity", <ActivityLog />, "/activity");
    await waitFor(() => expect(screen.getByText("item-unfiltered")).toBeInTheDocument());

    fireEvent.change(await screen.findByLabelText(/Tipo de recurso/), { target: { value: "ExpirationItem" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(screen.getByText("item-filtered")).toBeInTheDocument());

    // The new query key re-enters `isPending` until it resolves, swapping the whole page for a
    // skeleton (same branch as the initial load) - `findByRole` waits that out before clicking.
    fireEvent.click(await screen.findByRole("button", { name: "Limpar filtros" }));
    expect(screen.getByLabelText(/Tipo de recurso/)).toHaveValue("");
    await waitFor(() => expect(screen.getByText("item-unfiltered")).toBeInTheDocument());
  });

  // Mutation: showing populated content for an empty response would fail this case.
  it("shows an empty state when there are no events", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    getMock.mockResolvedValue({ entries: [], cursor: null, hasMore: false });

    renderAtRoute("/activity", <ActivityLog />, "/activity");

    await waitFor(() => expect(screen.getByText("Nenhum evento encontrado nesta consulta. Revise os filtros ou carregue a próxima página, se disponível.")).toBeInTheDocument());
  });
});
