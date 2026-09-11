import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { RequestDeliverySettings } from "../../../src/routes/subjects/RequestDeliverySettings.js";
import { ToastProvider } from "../../../src/components/Toast.js";
import { ApiError } from "../../../src/api/errors.js";

function renderScreen() {
  return renderAtRoute(
    "/settings/request-delivery",
    <ToastProvider>
      <RequestDeliverySettings />
    </ToastProvider>,
    "/settings/request-delivery",
  );
}

const { getMock, putMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, put: putMock, post: vi.fn(), delete: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function conflictError() {
  return new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "Version conflict.", retryable: false });
}

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("RequestDeliverySettings (A22, Block 7)", () => {
  it("redirects a non-OWNER away from the route (never renders the settings, matching the spec's 'totalmente ausente' instruction)", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });
    renderScreen();

    // The header renders unconditionally while the role is still resolving (mirrors
    // ActivityLog.tsx's own "don't block on pending" convention) - the real assertion is that it
    // disappears once the role resolves to a non-OWNER and the redirect fires.
    await waitFor(() => expect(screen.queryByText("Entrega de solicitação")).not.toBeInTheDocument());
    expect(getMock).not.toHaveBeenCalled();
  });

  it("an OWNER sees the current preference pre-selected", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockResolvedValue({ initialInviteDeliveryDefault: "MANUAL" });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Entrega manual")).toBeChecked());
    expect(screen.getByLabelText("E-mail automático")).not.toBeChecked();
  });

  it("saves the new selection and shows a success toast", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockResolvedValue({ initialInviteDeliveryDefault: "MANUAL" });
    putMock.mockResolvedValue(undefined);
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Entrega manual")).toBeChecked());
    screen.getByLabelText("E-mail automático").click();
    screen.getByRole("button", { name: "Salvar padrão" }).click();

    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/subjects/document-request-delivery-preference", { initialInviteDeliveryDefault: "EMAIL" }));
  });

  it("shows the OCC-conflict InlineNotice (never the generic error) when the save races a concurrent update", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockResolvedValue({ initialInviteDeliveryDefault: "MANUAL" });
    putMock.mockRejectedValue(conflictError());
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Entrega manual")).toBeChecked());
    screen.getByRole("button", { name: "Salvar padrão" }).click();

    await waitFor(() => expect(screen.getByText(/alterado por outra pessoa/)).toBeInTheDocument());
    expect(screen.queryByText("Não foi possível salvar. Tente novamente.")).not.toBeInTheDocument();
  });

  it("shows the generic error (and preserves the user's selection) on a non-conflict save failure", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockResolvedValue({ initialInviteDeliveryDefault: "MANUAL" });
    putMock.mockRejectedValue(new Error("network down"));
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Entrega manual")).toBeChecked());
    screen.getByLabelText("E-mail automático").click();
    screen.getByRole("button", { name: "Salvar padrão" }).click();

    await waitFor(() => expect(screen.getByText("Não foi possível salvar. Tente novamente.")).toBeInTheDocument());
    expect(screen.getByLabelText("E-mail automático")).toBeChecked();
  });

  // Codex review round 1 (Block 7, D-267) MÉDIO finding, corrected: the radios stayed
  // interactive mid-save, letting a user flip the visible selection to a value the server never
  // actually received before the toast confirmed success.
  it("disables the radios while a save is in flight", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockResolvedValue({ initialInviteDeliveryDefault: "MANUAL" });
    let resolvePut: (() => void) | undefined;
    putMock.mockReturnValue(new Promise<void>((resolve) => (resolvePut = resolve)));
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Entrega manual")).toBeChecked());
    screen.getByRole("button", { name: "Salvar padrão" }).click();

    await waitFor(() => expect(screen.getByLabelText("Entrega manual")).toBeDisabled());
    expect(screen.getByLabelText("E-mail automático")).toBeDisabled();
    resolvePut?.();
  });

  it("shows an error state with retry when the initial GET fails", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockRejectedValue(new Error("down"));
    renderScreen();

    await waitFor(() => expect(screen.getByText("Não foi possível carregar a configuração atual.")).toBeInTheDocument());
  });
});
