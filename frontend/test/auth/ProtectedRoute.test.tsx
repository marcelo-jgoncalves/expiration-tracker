/**
 * ProtectedRoute (A01 real architecture — see docs/frontend/prototype-screen-specs/A01-sign-in.md
 * post-correction): proves the state -> render/call mapping ONLY - for each `AuthState`, does it
 * render children/a loading placeholder/a redirecting placeholder, and does it call
 * `reauthenticate()` exactly once on the initial render of a redirect-triggering state. It does
 * NOT prove (Codex block-review finding, D-256, corrected scope claim): that the real full-page
 * navigation happens, that `returnTo` reaches `/bff/login` correctly, or that a re-render of the
 * SAME state never calls `reauthenticate()` a second time (this file mocks `useAuth` itself, so
 * `reauthenticate` here is a fresh spy per test, not the real hook's memoized callback) - those
 * are `AuthContext.test.tsx` (URL/returnTo) and `e2e/smoke.spec.ts` (the real page.goto/redirect
 * request assertions) reponsibility, not this component-level test's.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProtectedRoute } from "../../src/auth/ProtectedRoute.js";
import { useAuth, type AuthState } from "../../src/auth/AuthContext.js";

vi.mock("../../src/auth/AuthContext.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth/AuthContext.js")>("../../src/auth/AuthContext.js");
  return { ...actual, useAuth: vi.fn() };
});

const useAuthMock = vi.mocked(useAuth);

function mockState(state: AuthState, reauthenticate = vi.fn()) {
  useAuthMock.mockReturnValue({
    state,
    reportUnauthorized: vi.fn(),
    reauthenticate,
    logout: vi.fn(),
    logoutEverywhere: vi.fn(),
  });
  return reauthenticate;
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe("ProtectedRoute", () => {
  it("renders children when AUTHENTICATED, without calling reauthenticate", () => {
    const reauthenticate = mockState({ status: "AUTHENTICATED" });
    render(
      <ProtectedRoute>
        <div>protected content</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText("protected content")).toBeInTheDocument();
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it("renders the neutral initial-loading state while SESSION_REFRESHING, without redirecting", () => {
    const reauthenticate = mockState({ status: "SESSION_REFRESHING" });
    render(
      <ProtectedRoute>
        <div>protected content</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it.each([
    ["SESSION_MISSING", { status: "SESSION_MISSING" } as AuthState],
    ["SESSION_EXPIRED", { status: "SESSION_EXPIRED", returnTo: "/app/org-1/items" } as AuthState],
    ["REFRESH_FAILED", { status: "REFRESH_FAILED", returnTo: "/app/org-1/items" } as AuthState],
  ])("triggers exactly one reauthenticate() redirect and shows the redirecting placeholder for %s", (_label, state) => {
    const reauthenticate = mockState(state);
    render(
      <ProtectedRoute>
        <div>protected content</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Redirecionando…");
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  it("shows the redirecting placeholder for REAUTH_REQUIRED without re-triggering reauthenticate (the effect only fires for the 3 states above)", () => {
    const reauthenticate = mockState({ status: "REAUTH_REQUIRED", returnTo: "/app/org-1/items" });
    render(
      <ProtectedRoute>
        <div>protected content</div>
      </ProtectedRoute>,
    );
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Redirecionando…");
    expect(reauthenticate).not.toHaveBeenCalled();
  });
});
