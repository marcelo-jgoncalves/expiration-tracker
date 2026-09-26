import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { Settings } from "../../src/routes/Settings.js";
import { ApiError } from "../../src/api/errors.js";

const { getMock, patchMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: (path: string, options: unknown) => path === "/organizations/members" ? Promise.resolve({ members: [] }) : getMock(path, options), request: patchMock, post: postMock, put: vi.fn(), delete: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

beforeEach(() => {
  getMock.mockReset();
  // A19 storage section (D-2xx) - every Settings render now also fires useStorageQuota(); a
  // benign default here keeps the existing tests below (none of which are ABOUT storage)
  // focused on their own assertions rather than an unrelated pending/error query.
  getMock.mockResolvedValue({
    usage: { limitBytes: 1, usedBytes: 0, reservedBytes: 0, availableBytes: 1, usedPercent: 0, warningLevel: "OK" },
  });
  patchMock.mockReset();
  postMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("Settings", () => {
  // Mutation: allowing a non-owner to edit settings would fail this case.
  it("shows a read-only view for a non-OWNER", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getAllByText("Acme")[0]).toBeInTheDocument());
    expect(screen.getByText("Somente o Owner da organização pode alterar essas configurações.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Nome da organização/)).not.toBeInTheDocument();
  });

  // Mutation: sending a hardcoded version instead of the loaded version would fail this case.
  it("prefills the form with the current displayName for an OWNER, and submits an update with the real version", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 3 }] });
    patchMock.mockResolvedValue({ organizationId: "org-1", displayName: "Acme Corp", timezone: "America/Sao_Paulo", defaultReminderLocalTime: "09:00", version: 4 });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByLabelText(/Nome da organização/)).toHaveValue("Acme"));
    fireEvent.change(screen.getByLabelText(/Nome da organização/), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText(/Horário padrão de novos lembretes/), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    // Mutação: usar um expectedVersion hardcoded (ex. 1) em vez do version real da organização
    // (3) faria esta asserção falhar - prova que Settings.tsx lê o version real, não um valor
    // fixo, fechando o bug que existia antes desta correção (activeOrganization.role usado como
    // condição sem sentido).
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/settings", { method: "PATCH", body: { displayName: "Acme Corp", defaultReminderLocalTime: "09:00" }, expectedVersion: 3 }),
    );
    // Wave B2B-11: observed a one-off flake on a post-merge CI run (this exact assertion,
    // never reproduced locally across repeated runs) - a longer timeout is a proportional
    // defensive margin against CI scheduling variance, not a change to what is being proven.
    await waitFor(() => expect(screen.getByText("Configurações salvas.")).toBeInTheDocument(), { timeout: 3000 });
  });

  // Item 11 adversarial review (2026-09-25) real finding: this test used to assert the field
  // rendered EMPTY for an organization created before this feature existed
  // (`defaultReminderLocalTime` absent) - an empty string fails the HH:mm validation below,
  // which meant such an organization could not save ANY change (even just editing the name)
  // without the owner first picking a time. Fixed: the field now pre-fills with the same
  // `FALLBACK_DEFAULT_LOCAL_TIME` the rest of the app already uses for this case, so the form
  // starts valid/submittable without forcing an unrelated edit.
  // Mutation: reverting to an empty initial value, or to any value other than the fallback,
  // would fail this case.
  it("pre-fills the fallback time (never empty) when no organization default exists, and allows saving without touching it", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    patchMock.mockResolvedValue({ organizationId: "org-1", displayName: "Acme Corp", timezone: "America/Sao_Paulo", defaultReminderLocalTime: "09:00", version: 2 });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByLabelText(/Horário padrão de novos lembretes/)).toHaveValue("09:00"));

    // Only the name is edited - the time field is never touched, proving it does not block an
    // unrelated save.
    fireEvent.change(screen.getByLabelText(/Nome da organização/), { target: { value: "Acme Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/settings", { method: "PATCH", body: { displayName: "Acme Corp", defaultReminderLocalTime: "09:00" }, expectedVersion: 1 }),
    );
  });

  // Mutação: ler `activeOrganization.defaultReminderLocalTime` errado (ex. sempre o fallback)
  // faria esta asserção falhar mesmo com um valor real de organização já sorteado presente.
  // Mutation: ignoring the saved reminder time would fail this case.
  it("prefills the reminder time select with the organization's already-sorted value", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1, defaultReminderLocalTime: "14:30" }] });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByLabelText(/Horário padrão de novos lembretes/)).toHaveValue("14:30"));
  });

  // Mutation: hiding a settings conflict would fail this case.
  it("shows a conflict-specific message on a stale expectedVersion (OCC)", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    patchMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "VERSION_CONFLICT", retryable: false }, 409));

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByLabelText(/Nome da organização/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Horário padrão de novos lembretes/), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(screen.getByText(/As configurações mudaram em outra sessão/)).toBeInTheDocument(), { timeout: 3000 });
  });

  // Wave B2B-14 (D-120): handleLeaveOrganization has been fully wired end-to-end since B2B-8,
  // but no frontend call site ever existed until this button.
  // Mutation: leaving without confirmation would fail this case.
  it("shows a leave-organization button for a non-OWNER, and calls the leave endpoint on click", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "MEMBER", version: 1 }] });
    postMock.mockResolvedValue(undefined);

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getAllByText("Acme")[0]).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Sair da organização" }));
    expect(postMock).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sair da organização" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/organizations/members/leave", undefined));
  });

  // Mutation: hiding a last-owner rejection would fail this case.
  it("shows a leave-organization button for an OWNER too, with a friendly message on LAST_OWNER", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    postMock.mockRejectedValue(new ApiError({ code: "LAST_OWNER", category: "BUSINESS_RULE", message: "Cannot complete this action.", retryable: false }, 422));

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByLabelText(/Nome da organização/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Sair da organização" }));
    expect(postMock).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sair da organização" }));

    await waitFor(() => expect(screen.getByText(/único Owner desta organização/)).toBeInTheDocument());
  });

  // W3-07 (D-124): the organization-closure section. The most destructive action in the product,
  // so the confirmation gate is what these tests are actually about.
  // Mutation: offering closure to a non-owner would fail this case.
  it("never shows the close-organization section to a non-OWNER", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "ADMIN", version: 1 }] });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getAllByText("Acme")[0]).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Encerrar organização/ })).not.toBeInTheDocument();
  });

  // Mutation: closing without the exact organization identifier would fail this case.
  it("keeps the close button disabled until the organization id is typed exactly", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });

    renderAtRoute("/settings", <Settings />, "/settings");

    fireEvent.click(await screen.findByRole("button", { name: "Encerrar organização" }));
    await screen.findByRole("dialog");
    expect(postMock).not.toHaveBeenCalled();
    const button = within(screen.getByRole("dialog")).getByRole("button", { name: "Encerrar organização" });

    // Mutation that must fail: dropping the `disabled={!confirmed}` guard (or comparing against
    // displayName instead of organizationId) makes the button clickable with the wrong text, which
    // is the entire point of type-to-confirm for an irreversible action.
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Identificador da organização/), { target: { value: "Acme" } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Identificador da organização/), { target: { value: "org-1" } });
    expect(button).not.toBeDisabled();
  });

  // Mutation: posting an incorrect confirmation identifier would fail this case.
  it("posts the confirmation token to the close endpoint and reports the closure as started", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    postMock.mockResolvedValue({ organizationId: "org-1", status: "DELETING" });

    renderAtRoute("/settings", <Settings />, "/settings");

    fireEvent.click(await screen.findByRole("button", { name: "Encerrar organização" }));
    await screen.findByRole("dialog");
    expect(postMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Identificador da organização/), { target: { value: "org-1" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Encerrar organização" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/organizations/close", { confirmOrganizationId: "org-1" }));
    await waitFor(() => expect(screen.getByText(/Encerramento solicitado/)).toBeInTheDocument(), { timeout: 3000 });
  });

  // Mutation: hiding a closure conflict would fail this case.
  it("explains a CONFLICT as already-closing/closed rather than a generic failure", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    postMock.mockRejectedValue(new ApiError({ code: "ORGANIZATION_CLOSURE_UNAVAILABLE", category: "CONFLICT", message: "already closing", retryable: false }, 409));

    renderAtRoute("/settings", <Settings />, "/settings");

    fireEvent.click(await screen.findByRole("button", { name: "Encerrar organização" }));
    await screen.findByRole("dialog");
    expect(postMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Identificador da organização/), { target: { value: "org-1" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Encerrar organização" }));

    await waitFor(() => expect(screen.getByText(/já está em encerramento/)).toBeInTheDocument(), { timeout: 3000 });
  });

  // A19 "seção de armazenamento" (D-2xx): docarchive:read is READ_ONLY_ROLES (every role), so
  // this must be visible to a non-OWNER too, unlike the displayName form above it.
  // Mutation: hiding storage from a viewer would fail this case.
  it("shows the storage section to a non-OWNER", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "VIEWER", version: 1 }] });
    getMock.mockResolvedValue({
      usage: { limitBytes: 8 * 1024 * 1024 * 1024, usedBytes: 4 * 1024 * 1024 * 1024, reservedBytes: 0, availableBytes: 4 * 1024 * 1024 * 1024, usedPercent: 0.5, warningLevel: "OK" },
    });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByText(/4 GB de 8 GB utilizados/)).toBeInTheDocument());
  });

  // Mutation: hiding the over-quota restriction would fail this case.
  it("shows the OVER-state upload-blocked notice in the storage section", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    getMock.mockResolvedValue({
      usage: { limitBytes: 8 * 1024 * 1024 * 1024, usedBytes: 8 * 1024 * 1024 * 1024, reservedBytes: 0, availableBytes: 0, usedPercent: 1, warningLevel: "OVER" },
    });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByText(/Novos uploads bloqueados/)).toBeInTheDocument());
  });

  // Codex block-review finding (D-256): StorageSection previously returned null on both
  // loading AND error, making a real backend/authorization failure indistinguishable from "no
  // storage data" and giving the user no way to retry. Now it shows a real ErrorState with a
  // working retry, same discipline as the dashboard's own error handling (Overview.test.tsx).
  // Mutation: making a storage read failure indistinguishable from no usage would fail this case.
  it("shows a retryable error state in the storage section when the storage-usage fetch fails, never a silent disappearance", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });
    let callCount = 0;
    getMock.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.reject(new ApiError({ code: "INTERNAL", category: "INTERNAL", message: "erro interno", retryable: false }, 500));
      return Promise.resolve({
        usage: { limitBytes: 8 * 1024 * 1024 * 1024, usedBytes: 1024, reservedBytes: 0, availableBytes: 8 * 1024 * 1024 * 1024, usedPercent: 0, warningLevel: "OK" },
      });
    });

    renderAtRoute("/settings", <Settings />, "/settings");

    await waitFor(() => expect(screen.getByText("Não foi possível carregar o uso de armazenamento.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(screen.getByText(/1 KB de 8 GB utilizados/)).toBeInTheDocument());
    expect(callCount).toBe(2);
  });
});
