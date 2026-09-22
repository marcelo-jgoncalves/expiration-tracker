import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SignUp } from "../../../src/routes/auth/SignUp.js";
import { ApiError } from "../../../src/api/errors.js";

const { signUpMock, navigateMock, useAuthMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  navigateMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../../../src/api/auth.js", () => ({
  login: vi.fn(),
  signUp: signUpMock,
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

function renderSignUp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/signup"]}>
        <Routes>
          <Route path="/signup" element={<SignUp />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  signUpMock.mockReset();
  navigateMock.mockReset();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue({ state: { status: "SESSION_MISSING" } });
});

describe("SignUp", () => {
  it("blocks submission client-side when the passwords don't match, never calling the API", () => {
    renderSignUp();
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(screen.getByText("As senhas não coincidem.")).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("submits and navigates to /verify-email with the e-mail as a query param on success", async () => {
    signUpMock.mockResolvedValue({ status: "CONFIRMATION_REQUIRED" });
    renderSignUp();
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledWith({ email: "new@example.com", password: "Correct-Horse-1" }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/verify-email?email=new%40example.com", { replace: true }));
  });

  it("shows a specific message when the e-mail is already registered (CONFLICT)", async () => {
    signUpMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "Já existe uma conta com este e-mail.", retryable: false }, 409));
    renderSignUp();
    fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: "taken@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.change(screen.getByLabelText(/Confirmar senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));

    await waitFor(() => expect(screen.getByText("Já existe uma conta com este e-mail.")).toBeInTheDocument());
  });
});
