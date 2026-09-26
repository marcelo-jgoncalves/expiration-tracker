import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../../src/auth/AuthContext.js";
import { SessionProbeError } from "../../src/api/session.js";
import { sessionQueryKey } from "../../src/api/queryKeys.js";

const { fetchSessionInfoMock, logoutMock, logoutAllMock } = vi.hoisted(() => ({
  fetchSessionInfoMock: vi.fn(),
  logoutMock: vi.fn(),
  logoutAllMock: vi.fn(),
}));

vi.mock("../../src/api/session.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/session.js")>("../../src/api/session.js");
  return {
    ...actual,
    fetchSessionInfo: fetchSessionInfoMock,
    logout: logoutMock,
    logoutAll: logoutAllMock,
  };
});

vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { setOnUnauthorized: vi.fn() },
}));

function Probe() {
  const { state } = useAuth();
  return <div data-testid="state">{state.status}</div>;
}

/** D-136/D-A: AuthProvider now reads a real TanStack Query (the shared `sessionQueryKey`),
 * so every render needs a real QueryClientProvider ancestor - a fresh, retry-disabled client
 * per test (mirrors `test/testUtils.tsx`'s `renderAtRoute` pattern) so no test's timing depends
 * on another's cache. */
/** D-3xx: AuthProvider now calls `useNavigate()` internally (`reauthenticate()` navigates to
 * the app's own `/login` screen instead of a full-page redirect) - needs a Router ancestor,
 * same MemoryRouter convention every routed test already uses (test/testUtils.tsx). */
function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

beforeEach(() => {
  fetchSessionInfoMock.mockReset();
  logoutMock.mockReset();
  logoutAllMock.mockReset();
});

describe("AuthProvider", () => {
  // Wave B2B-10 (D-1XX): the mocked shape here is the REAL GET /bff/session response since
  // B2B-6 (no tenantId/userId, ever) - mutation: reverting probe() to require
  // info.tenantId && info.userId (the pre-B2B-10 regression) makes this test hang at
  // SESSION_REFRESHING/fail the AUTHENTICATED assertion, since neither field exists here.
  it("starts at SESSION_REFRESHING, then resolves to AUTHENTICATED when the BFF confirms a session", async () => {
    fetchSessionInfoMock.mockResolvedValue({ authenticated: true, activeOrganizationId: "org-1" });
    renderWithClient(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("SESSION_REFRESHING");
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED"));
  });

  it("resolves to SESSION_MISSING when the BFF plainly says not authenticated", async () => {
    fetchSessionInfoMock.mockResolvedValue({ authenticated: false });
    renderWithClient(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("SESSION_MISSING"));
  });

  it("resolves to REFRESH_FAILED (not SESSION_MISSING) when the probe itself could not be completed - uncertainty is not the same as a definitive logout", async () => {
    fetchSessionInfoMock.mockRejectedValue(new SessionProbeError("network down"));
    renderWithClient(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("REFRESH_FAILED"));
  });

  function ProbeWithControls() {
    const { state, reportUnauthorized, logout } = useAuth();
    return (
      <div>
        <div data-testid="state">{state.status}</div>
        <button onClick={reportUnauthorized}>report-401</button>
        <button onClick={() => void logout()}>logout</button>
      </div>
    );
  }

  it("reportUnauthorized transitions AUTHENTICATED -> SESSION_EXPIRED, carrying a returnTo", async () => {
    fetchSessionInfoMock.mockResolvedValue({ authenticated: true, activeOrganizationId: "org-1" });
    renderWithClient(
      <AuthProvider>
        <ProbeWithControls />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED"));

    await act(async () => {
      screen.getByText("report-401").click();
    });
    expect(screen.getByTestId("state").textContent).toBe("SESSION_EXPIRED");
  });

  it("reportUnauthorized is a no-op when the state is not AUTHENTICATED (never downgrades SESSION_MISSING into a fabricated expiry)", async () => {
    fetchSessionInfoMock.mockResolvedValue({ authenticated: false });
    renderWithClient(
      <AuthProvider>
        <ProbeWithControls />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("SESSION_MISSING"));

    await act(async () => {
      screen.getByText("report-401").click();
    });
    expect(screen.getByTestId("state").textContent).toBe("SESSION_MISSING");
  });

  function ProbeWithReauth() {
    const { state, reportUnauthorized, clearReauthLatch } = useAuth();
    return (
      <div>
        <div data-testid="state">{state.status}</div>
        <button onClick={reportUnauthorized}>report-401</button>
        <button onClick={clearReauthLatch}>clear-latch</button>
      </div>
    );
  }

  // Marcelo, 2026-09-22, real bug: once `reportedUnauthorized` latches SESSION_EXPIRED, `state`
  // stays pinned there even after the session query genuinely resolves to authenticated - the
  // latch is what `clearReauthLatch()` (called by `useLogin`'s `onSuccess`) exists to clear.
  // Would fail (state staying SESSION_EXPIRED) if `clearReauthLatch` were removed, or if `state`'s
  // `useMemo` stopped checking `reportedUnauthorized` before falling through to session data.
  it("stays SESSION_EXPIRED even once the session re-resolves to authenticated, until clearReauthLatch() runs", async () => {
    fetchSessionInfoMock.mockResolvedValue({ authenticated: true, activeOrganizationId: "org-1" });
    const { queryClient } = renderWithClient(
      <AuthProvider>
        <ProbeWithReauth />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED"));

    await act(async () => {
      screen.getByText("report-401").click();
    });
    expect(screen.getByTestId("state").textContent).toBe("SESSION_EXPIRED");

    // Mirrors a real successful re-login: the session probe would now say authenticated again,
    // and `useLogin`'s `onSuccess` invalidates the session query - but WITHOUT also clearing the
    // latch, `state` stays pinned at SESSION_EXPIRED regardless (the bug).
    fetchSessionInfoMock.mockResolvedValue({ authenticated: true, activeOrganizationId: "org-1" });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    });
    expect(screen.getByTestId("state").textContent).toBe("SESSION_EXPIRED");

    // Now the missing piece: clearing the latch (what `clearReauthLatch()` does) lets `state`
    // fall through to the now-fresh, genuinely authenticated session data.
    await act(async () => {
      screen.getByText("clear-latch").click();
    });
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED"));
  });

  it("logout() calls the BFF's logout endpoint and returns to SESSION_MISSING", async () => {
    fetchSessionInfoMock.mockResolvedValue({ authenticated: true, activeOrganizationId: "org-1" });
    logoutMock.mockResolvedValue(undefined);
    renderWithClient(
      <AuthProvider>
        <ProbeWithControls />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED"));

    await act(async () => {
      screen.getByText("logout").click();
    });
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state").textContent).toBe("SESSION_MISSING");
  });
});
