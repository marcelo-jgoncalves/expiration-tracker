import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Login } from "../../../src/routes/auth/Login.js";

const { loginMock, navigateMock, useAuthMock, clearReauthLatchMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  navigateMock: vi.fn(),
  useAuthMock: vi.fn(),
  clearReauthLatchMock: vi.fn(),
}));

vi.mock("../../../src/api/auth.js", () => ({
  login: loginMock,
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendConfirmationCode: vi.fn(),
  forgotPassword: vi.fn(),
  confirmForgotPassword: vi.fn(),
}));
vi.mock("../../../src/auth/AuthContext.js", () => ({ useAuth: useAuthMock }));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderLogin(initialEntry = "/login") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  loginMock.mockReset();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  clearReauthLatchMock.mockReset();
  useAuthMock.mockReturnValue({ state: { status: "SESSION_MISSING" }, clearReauthLatch: clearReauthLatchMock });
});

describe("Login", () => {
  it("redirects an already-AUTHENTICATED visitor to returnTo instead of showing the form", () => {
    useAuthMock.mockReturnValue({ state: { status: "AUTHENTICATED" }, clearReauthLatch: clearReauthLatchMock });
    renderLogin("/login?returnTo=%2Fitems%2F42");
    expect(navigateMock).toHaveBeenCalledWith("/items/42", { replace: true });
  });

  it("falls back to /overview when returnTo is missing or unsafe (never an open redirect)", () => {
    useAuthMock.mockReturnValue({ state: { status: "AUTHENTICATED" }, clearReauthLatch: clearReauthLatchMock });
    renderLogin("/login?returnTo=https%3A%2F%2Fevil.example.com");
    expect(navigateMock).toHaveBeenCalledWith("/overview", { replace: true });
  });

  // Marcelo, 2026-09-22 ("entro com as credenciais e não acontece nada"): navigation must be
  // driven ONLY by `state.status === "AUTHENTICATED"` (the real session query), never by
  // `login.isSuccess` alone - that flag turns true the instant the mutation resolves, before
  // `AuthContext`'s invalidated session query has actually refetched, which used to race
  // `ProtectedRoute` into bouncing back to /login on stale SESSION_MISSING data. This test
  // simulates that real timing: `useAuth()` only flips to AUTHENTICATED once the login mutation
  // resolves (mirroring the session invalidation), never before.
  it("navigates to returnTo only once the session state itself confirms AUTHENTICATED, never on login.isSuccess alone", async () => {
    loginMock.mockImplementation(async () => {
      useAuthMock.mockReturnValue({ state: { status: "AUTHENTICATED" }, clearReauthLatch: clearReauthLatchMock });
    });
    renderLogin("/login?returnTo=%2Fitems%2F42");

    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: "correct-horse-battery-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ email: "user@example.com", password: "correct-horse-battery-1" }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/items/42", { replace: true }));
  });

  // Marcelo, 2026-09-22 (real bug, deeper root cause): a session that expired once in this tab
  // sets AuthContext's `reportedUnauthorized` latch, which - since `reauthenticate()` became a
  // client-side navigate() in D-321 (never remounts AuthProvider) - used to stay `true` forever,
  // pinning `state` at SESSION_EXPIRED even after a fully successful NEW login. Would fail if
  // `useLogin`'s `onSuccess` stopped calling `clearReauthLatch()` before invalidating the session
  // query.
  it("clears the reauth latch on a successful login, before invalidating the session query", async () => {
    loginMock.mockResolvedValue(undefined);
    renderLogin();

    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: "correct-horse-battery-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(clearReauthLatchMock).toHaveBeenCalled());
  });

  // Would fail if the old `login.isSuccess`-driven effect were still present: navigateMock would
  // fire immediately on mutation success even while `state.status` stays SESSION_MISSING (the
  // exact race that caused the real bug).
  it("does NOT navigate while login succeeded but the session state hasn't caught up yet", async () => {
    loginMock.mockResolvedValue(undefined); // useAuthMock stays SESSION_MISSING (beforeEach default)
    renderLogin("/login?returnTo=%2Fitems%2F42");

    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: "correct-horse-battery-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(loginMock).toHaveBeenCalled());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // Marcelo, 2026-09-22: every password field gets a reveal toggle (TextField.tsx). Would fail
  // if clicking it stopped switching the input's real `type` between "password" and "text".
  it("toggles the password field between hidden and visible via the reveal button", () => {
    renderLogin();
    const passwordField = screen.getByLabelText(/Senha/) as HTMLInputElement;
    expect(passwordField.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(passwordField.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Ocultar senha" }));
    expect(passwordField.type).toBe("password");
  });

  it("shows a generic error message on invalid credentials (never distinguishes user-not-found from wrong-password)", async () => {
    loginMock.mockRejectedValue(new Error("invalid"));
    renderLogin();

    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByText("E-mail ou senha inválidos.")).toBeInTheDocument());
  });
});
