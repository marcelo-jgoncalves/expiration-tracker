import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Login } from "../../../src/routes/auth/Login.js";

const { loginMock, navigateMock, useAuthMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  navigateMock: vi.fn(),
  useAuthMock: vi.fn(),
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
  useAuthMock.mockReturnValue({ state: { status: "SESSION_MISSING" } });
});

describe("Login", () => {
  it("redirects an already-AUTHENTICATED visitor to returnTo instead of showing the form", () => {
    useAuthMock.mockReturnValue({ state: { status: "AUTHENTICATED" } });
    renderLogin("/login?returnTo=%2Fitems%2F42");
    expect(navigateMock).toHaveBeenCalledWith("/items/42", { replace: true });
  });

  it("falls back to /overview when returnTo is missing or unsafe (never an open redirect)", () => {
    useAuthMock.mockReturnValue({ state: { status: "AUTHENTICATED" } });
    renderLogin("/login?returnTo=https%3A%2F%2Fevil.example.com");
    expect(navigateMock).toHaveBeenCalledWith("/overview", { replace: true });
  });

  it("submits email/password and navigates to returnTo on success", async () => {
    loginMock.mockResolvedValue(undefined);
    renderLogin("/login?returnTo=%2Fitems%2F42");

    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/Senha/), { target: { value: "correct-horse-battery-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ email: "user@example.com", password: "correct-horse-battery-1" }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/items/42", { replace: true }));
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
