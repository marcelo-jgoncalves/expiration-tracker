/**
 * ProtectedRoute (A01 real architecture — see docs/frontend/prototype-screen-specs/A01-sign-in.md
 * post-correction): unauthenticated/expired/refresh-failed states must trigger exactly one
 * `reauthenticate()` full-page-redirect call and render the neutral "Redirecionando…" structural
 * placeholder, never a dead end or a flash of protected content. AUTHENTICATED renders children;
 * SESSION_REFRESHING renders the neutral initial-loading state (no "validating session" wording,
 * D-136/D-A).
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
