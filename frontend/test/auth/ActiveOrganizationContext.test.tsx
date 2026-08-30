/**
 * Tests the real switch-race-handling mechanism itself (Wave B2B-10 design decision, Claude
 * 9.2/Codex 9.2, `docs/architecture/reviews/multi-user-b2b-wave-b2b10-scoping/`) - every other
 * route test uses the fixed stub in `test/testUtils.tsx` instead of this real, network-backed
 * Provider.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ActiveOrganizationProvider, useActiveOrganization } from "../../src/auth/ActiveOrganizationContext.js";

const { fetchSessionInfoMock, selectOrganizationMock } = vi.hoisted(() => ({
  fetchSessionInfoMock: vi.fn(),
  selectOrganizationMock: vi.fn(),
}));

vi.mock("../../src/api/session.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/session.js")>("../../src/api/session.js");
  return { ...actual, fetchSessionInfo: fetchSessionInfoMock };
});

vi.mock("../../src/api/organizations.js", () => ({
  selectOrganization: selectOrganizationMock,
}));

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ActiveOrganizationProvider>{children}</ActiveOrganizationProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  fetchSessionInfoMock.mockReset();
  selectOrganizationMock.mockReset();
});

describe("ActiveOrganizationProvider", () => {
  it("resolves organizationId from the session query", async () => {
    fetchSessionInfoMock.mockResolvedValue({ authenticated: true, activeOrganizationId: "org-a" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useActiveOrganization(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.organizationId).toBe("org-a"));
  });

  // Mutation: removing the `switching` flag entirely (or never setting it true in onMutate)
  // makes this assertion fail - the gate that every org-scoped useQuery's `enabled` depends on
  // would never actually block anything during a switch.
  it("sets switching=true synchronously when select() is called, and false once settled", async () => {
    fetchSessionInfoMock.mockResolvedValueOnce({ authenticated: true, activeOrganizationId: "org-a" });
    selectOrganizationMock.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useActiveOrganization(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.organizationId).toBe("org-a"));

    fetchSessionInfoMock.mockResolvedValueOnce({ authenticated: true, activeOrganizationId: "org-b" });
    act(() => result.current.select("org-b"));

    await waitFor(() => expect(result.current.switching).toBe(true));
    await waitFor(() => expect(result.current.switching).toBe(false));
    expect(result.current.organizationId).toBe("org-b");
  });

  // Mutation: dropping the `queryClient.cancelQueries` call in `onMutate` (or scoping it to the
  // wrong key) makes this assertion fail - this is the concrete mechanism that closes the
  // cross-tenant cache race the Codex Round 1/2 critique found (an in-flight request for the OLD
  // organization landing after the server has already flipped the session).
  it("cancels in-flight queries scoped to the CURRENT organization when a switch starts", async () => {
    fetchSessionInfoMock.mockResolvedValueOnce({ authenticated: true, activeOrganizationId: "org-a" });
    selectOrganizationMock.mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    const { result } = renderHook(() => useActiveOrganization(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.organizationId).toBe("org-a"));

    fetchSessionInfoMock.mockResolvedValueOnce({ authenticated: true, activeOrganizationId: "org-b" });
    await act(async () => {
      result.current.select("org-b");
      await waitFor(() => expect(result.current.switching).toBe(false));
    });

    expect(cancelSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["org", "org-a"], exact: false }));
  });

  it("does not cancel anything when no organization was previously active (first selection, e.g. onboarding)", async () => {
    fetchSessionInfoMock.mockResolvedValueOnce({ authenticated: true, organizationSelectionRequired: { organizations: [] } });
    selectOrganizationMock.mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    const { result } = renderHook(() => useActiveOrganization(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.organizationId).toBeUndefined());

    fetchSessionInfoMock.mockResolvedValueOnce({ authenticated: true, activeOrganizationId: "org-new" });
    await act(async () => {
      result.current.select("org-new");
      await waitFor(() => expect(result.current.switching).toBe(false));
    });

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(result.current.organizationId).toBe("org-new");
  });
});
