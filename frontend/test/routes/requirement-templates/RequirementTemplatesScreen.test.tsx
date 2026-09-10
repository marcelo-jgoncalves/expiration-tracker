import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute, TEST_ORGANIZATION_ID } from "../../testUtils.js";
import { RequirementTemplatesScreen } from "../../../src/routes/requirement-templates/RequirementTemplatesScreen.js";
import { ApiError } from "../../../src/api/errors.js";
import type { RequirementTemplate } from "../../../src/api/types.js";

const { getMock, postMock, requestMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(), requestMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, request: requestMock },
}));

function template(overrides: Partial<RequirementTemplate> = {}): RequirementTemplate {
  return {
    templateId: "tpl-1",
    displayName: "Fornecedor de serviços — padrão",
    status: "ACTIVE",
    items: [
      { templateItemId: "item-1", name: "CND Federal", applicability: "APPLICABLE", position: 0 },
      { templateItemId: "item-2", name: "CND Estadual", applicability: "APPLICABLE", position: 1 },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

/** Same `fetch`-vs-`apiClient` split as A20's tests - `useCurrentMembershipRole()` resolves via
 * a direct `fetch("/bff/organizations", ...)`, never `apiClient`. */
function mockRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizations: [{ organizationId: TEST_ORGANIZATION_ID, displayName: "Acme", role, version: 1 }] }),
    }),
  );
}

function mockCatalog(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER", active: RequirementTemplate[], archived: RequirementTemplate[] = []) {
  mockRole(role);
  getMock.mockImplementation((path: string) => {
    if (path.includes("/requirement-templates/tpl-1")) return Promise.resolve({ requirementTemplate: [...active, ...archived].find((t) => t.templateId === "tpl-1") });
    if (path.includes("status=ARCHIVED")) return Promise.resolve({ requirementTemplates: archived });
    return Promise.resolve({ requirementTemplates: active });
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  requestMock.mockReset();
  vi.unstubAllGlobals();
});

describe("RequirementTemplatesScreen (A21)", () => {
  it("shows initial loading, then the catalog and the first template's detail by default", async () => {
    mockCatalog("VIEWER", [template()]);
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");

    expect(screen.getByText("Carregando templates de requisitos…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Fornecedor de serviços — padrão/ })).toBeInTheDocument());
    expect(screen.getByText("CND Federal")).toBeInTheDocument();
  });

  it("hides 'Novo template' and admin actions for a VIEWER, but shows no 'Aplicar a fornecedor' either", async () => {
    mockCatalog("VIEWER", [template()]);
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("heading", { name: /Fornecedor de serviços — padrão/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Novo template" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar a fornecedor" })).not.toBeInTheDocument();
  });

  it("shows 'Aplicar a fornecedor' for a MEMBER (WRITE_ROLES) but hides catalog-admin actions", async () => {
    mockCatalog("MEMBER", [template()]);
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicar" })).not.toBeInTheDocument();
  });

  it("shows catalog-admin actions AND apply for an ADMIN", async () => {
    mockCatalog("ADMIN", [template()]);
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Arquivar" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Duplicar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeInTheDocument();
  });

  it("shows a read-only notice for an ARCHIVED template and disables 'Editar', but still allows 'Duplicar' for ADMIN", async () => {
    mockCatalog("ADMIN", [], [template({ status: "ARCHIVED" })]);
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByText("Template arquivado — somente leitura para não-admins.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Editar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Duplicar" })).toBeEnabled();
    // "Aplicar a fornecedor" is disabled while archived, per the spec ("templates arquivados
    // não podem ser... aplicados por ninguém").
    expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeDisabled();
  });

  it("disables 'Aplicar a fornecedor' with a tooltip for a template with zero items", async () => {
    mockCatalog("MEMBER", [template({ items: [] })]);
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toHaveAttribute("title", "Adicione ao menos um item antes de aplicar");
  });

  it("shows the preview with NOVO/DUPLICATE_NAME outcomes and disables confirm when all items are duplicates", async () => {
    mockCatalog("MEMBER", [template()]);
    postMock.mockImplementation((path: string) => {
      if (path.includes("/preview")) {
        return Promise.resolve({
          create: [],
          skip: [
            { templateItemId: "item-1", name: "CND Federal", reason: "DUPLICATE_NAME", existingRequirementId: "req-1", sameTemplateItem: false },
            { templateItemId: "item-2", name: "CND Estadual", reason: "DUPLICATE_NAME", existingRequirementId: "req-2", sameTemplateItem: false },
          ],
          templateVersion: 3,
        });
      }
      return Promise.reject(new Error("unexpected POST"));
    });
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a fornecedor" }));
    fireEvent.change(screen.getByLabelText(/ID do fornecedor/), { target: { value: "subj-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar aplicação" }));

    await waitFor(() => expect(screen.getAllByText(/Já existe um requisito com este nome/).length).toBe(2));
    expect(screen.getByRole("button", { name: "Confirmar aplicação" })).toBeDisabled();
  });

  it("confirms an apply and shows the created/skipped summary", async () => {
    mockCatalog("MEMBER", [template()]);
    postMock.mockImplementation((path: string) => {
      if (path.includes("/preview")) {
        return Promise.resolve({ create: [{ templateItemId: "item-1", name: "CND Federal", applicability: "APPLICABLE", position: 0 }], skip: [], templateVersion: 3 });
      }
      if (path.includes("/apply")) {
        return Promise.resolve({ created: [{ templateItemId: "item-1", requirementId: "req-new", name: "CND Federal" }], skipped: [], templateVersion: 3 });
      }
      return Promise.reject(new Error("unexpected POST"));
    });
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a fornecedor" }));
    fireEvent.change(screen.getByLabelText(/ID do fornecedor/), { target: { value: "subj-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar aplicação" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar aplicação" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aplicação" }));

    await waitFor(() => expect(screen.getByText("1 requisito(s) criado(s), 0 ignorado(s) por duplicidade de nome.")).toBeInTheDocument());
  });

  // Codex block-review finding (HIGH): the preview must be bound to the exact Subject it was
  // computed for - editing the Subject field after a preview must never let confirm apply to a
  // DIFFERENT Subject than the one the visible preview describes. This test would fail against
  // the pre-fix code (which read the live `subjectId` state in `handleConfirm`, not a value
  // captured at preview time).
  it("clears the preview when the Subject field is edited after previewing (never applies to a different Subject than shown)", async () => {
    mockCatalog("MEMBER", [template()]);
    postMock.mockImplementation((path: string) => {
      if (path.includes("/preview")) return Promise.resolve({ create: [{ templateItemId: "item-1", name: "CND Federal", applicability: "APPLICABLE", position: 0 }], skip: [], templateVersion: 3 });
      return Promise.reject(new Error("unexpected POST"));
    });
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a fornecedor" }));
    fireEvent.change(screen.getByLabelText(/ID do fornecedor/), { target: { value: "subj-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar aplicação" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar aplicação" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/ID do fornecedor/), { target: { value: "subj-2" } });
    expect(screen.queryByRole("button", { name: "Confirmar aplicação" })).not.toBeInTheDocument();
  });

  // Codex block-review finding (HIGH): a CONFLICT on confirm (stale `expectedTemplateVersion`)
  // is definitive - it must never be offered the same "tentar novamente" retry as a genuine
  // unknown-outcome/network failure, since retrying would resend the same stale version.
  it("shows a re-preview message (not a blind retry) when confirm fails with a version CONFLICT", async () => {
    mockCatalog("MEMBER", [template()]);
    postMock.mockImplementation((path: string) => {
      if (path.includes("/preview")) return Promise.resolve({ create: [{ templateItemId: "item-1", name: "CND Federal", applicability: "APPLICABLE", position: 0 }], skip: [], templateVersion: 3 });
      if (path.includes("/apply")) return Promise.reject(new ApiError({ code: "VERSION_CONFLICT", category: "CONFLICT", message: "Version conflict.", retryable: false }));
      return Promise.reject(new Error("unexpected POST"));
    });
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar a fornecedor" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a fornecedor" }));
    fireEvent.change(screen.getByLabelText(/ID do fornecedor/), { target: { value: "subj-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar aplicação" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar aplicação" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar aplicação" }));

    await waitFor(() => expect(screen.getByText(/pré-visualize novamente antes de confirmar/)).toBeInTheDocument());
    expect(screen.queryByText("Tentar novamente apenas os pendentes")).not.toBeInTheDocument();
  });

  // Codex block-review finding (HIGH): "Editar" was a dead button with no onClick.
  it("opens a real edit form from 'Editar' and saves name/description", async () => {
    mockCatalog("ADMIN", [template()]);
    let updateBody: Record<string, unknown> | undefined;
    requestMock.mockImplementation((_path: string, options: { body?: Record<string, unknown> }) => {
      updateBody = options?.body;
      return Promise.resolve({ requirementTemplate: template({ displayName: "Novo nome" }) });
    });
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText(/Nome do template/), { target: { value: "Novo nome" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(updateBody?.["displayName"]).toBe("Novo nome"));
  });

  it("shows the EMPTY_TRUE state when there are no templates at all", async () => {
    mockCatalog("VIEWER", []);
    renderAtRoute("/settings/requirement-templates", <RequirementTemplatesScreen />, "/settings/requirement-templates");
    await waitFor(() => expect(screen.getByText("Nenhum template cadastrado ainda.")).toBeInTheDocument());
  });
});
