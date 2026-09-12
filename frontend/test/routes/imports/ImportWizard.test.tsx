import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { ImportWizard } from "../../../src/routes/imports/ImportWizard.js";
import type { ImportJob, MembershipRole } from "../../../src/api/types.js";

const { getMock, postMock, navigateMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(), navigateMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock },
}));

// Same convention as CreateItem.test.tsx: only `useNavigate` is swapped for a spy (everything
// else - MemoryRouter/Routes/Route/Link/useParams - stays real), so a navigation call is
// asserted directly rather than relying on a second route actually being registered in the
// test tree.
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

// jsdom doesn't reliably implement File#arrayBuffer/crypto.subtle - same discipline as
// ItemDocuments.test.tsx: the checksum computation itself is exercised in api/documents.test.ts.
vi.mock("../../../src/api/documents.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/api/documents.js")>("../../../src/api/documents.js");
  return { ...actual, computeChecksumSha256: vi.fn().mockResolvedValue("deadbeef") };
});

function mockAsRole(role: MembershipRole) {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    jobId: "job-1",
    tenantId: "org-1",
    targetEntityType: "TrackedSubject",
    status: "PREVIEW_READY",
    columnMapping: { schemaVersion: 1, targetKind: "TrackedSubject", columns: { displayName: "displayName", type: "type", externalId: "externalId" } },
    columnMappingSha256: "abc",
    totalRows: 10,
    acceptedRows: 7,
    rejectedRows: 1,
    duplicateRows: 2,
    expiresAt: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

function mockGetJob(currentJob: ImportJob) {
  getMock.mockImplementation((path: string) => {
    if (path === "/imports/job-1") return Promise.resolve({ job: currentJob });
    return Promise.reject(new Error("unexpected GET " + path));
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  navigateMock.mockReset();
  fetchOrganizationsMock.mockReset();
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("ImportWizard (A15, Block 9) — upload step (/imports/new)", () => {
  it("VIEWER cannot start a new import (import:create is WRITE_ROLES)", async () => {
    mockAsRole("VIEWER");
    renderAtRoute("/imports/new", <ImportWizard />, "/imports/new");
    await waitFor(() => expect(screen.getByText("Você não tem permissão para iniciar uma importação.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Selecionar arquivo")).not.toBeInTheDocument();
  });

  it("MEMBER sees the dropzone and every role tier's write action", async () => {
    mockAsRole("MEMBER");
    renderAtRoute("/imports/new", <ImportWizard />, "/imports/new");
    await waitFor(() => expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Enviar e continuar" })).toBeDisabled();
  });

  it("rejects a non-.csv file client-side with a specific reason, never a generic error", async () => {
    mockAsRole("OWNER");
    renderAtRoute("/imports/new", <ImportWizard />, "/imports/new");
    await waitFor(() => expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument());

    const file = new File(["a,b"], "fornecedores.xlsx", { type: "application/vnd.ms-excel" });
    fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [file] } });

    expect(await screen.findByText("Formato não reconhecido — envie um arquivo .csv.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar e continuar" })).toBeDisabled();
  });

  it("rejects a file bigger than the real 5 MB backend ceiling client-side", async () => {
    mockAsRole("OWNER");
    renderAtRoute("/imports/new", <ImportWizard />, "/imports/new");
    await waitFor(() => expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument());

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "grande.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [big] } });

    expect(await screen.findByText("Arquivo maior que 5 MB.")).toBeInTheDocument();
  });

  it("reserves the job (phase 1), PUTs the bytes (phase 2), then navigates to /imports/:jobId - never the other order", async () => {
    mockAsRole("OWNER");
    const callOrder: string[] = [];
    postMock.mockImplementation(async (path: string) => {
      callOrder.push("reserve:" + path);
      return { jobId: "job-new", uploadUrl: "https://storage.example.com/upload", requiredHeaders: { "x-amz-meta": "x" }, expiresAt: "2026-01-01T00:10:00.000Z" };
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callOrder.push("put");
      return new Response(null, { status: 200 });
    });
    renderAtRoute("/imports/new", <ImportWizard />, "/imports/new");
    await waitFor(() => expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument());

    const file = new File(["displayName,type\nAcme,VENDOR"], "fornecedores.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar e continuar" }));

    await waitFor(() => expect(callOrder).toEqual(["reserve:/imports", "put"]));
    expect(postMock).toHaveBeenCalledWith("/imports", { contentLength: file.size, checksumSha256: "deadbeef" }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(fetchSpy).toHaveBeenCalledWith("https://storage.example.com/upload", { method: "PUT", headers: { "x-amz-meta": "x" }, body: file });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/app/org-1/imports/job-new"));
    fetchSpy.mockRestore();
  });

  it("a reservation failure never attempts the PUT, and is surfaced visibly", async () => {
    mockAsRole("OWNER");
    postMock.mockRejectedValue(new Error("boom"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderAtRoute("/imports/new", <ImportWizard />, "/imports/new");
    await waitFor(() => expect(screen.getByLabelText("Selecionar arquivo")).toBeInTheDocument());

    const file = new File(["displayName,type\nAcme,VENDOR"], "fornecedores.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Selecionar arquivo"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar e continuar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível enviar o arquivo."));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ImportWizard — resuming /imports/:jobId at every real status", () => {
  it("every role (including VIEWER) can read a job's status (import:read is READ_ONLY_ROLES)", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as MembershipRole[]) {
      mockAsRole(role);
      mockGetJob(job({ status: "PARSING", totalRows: undefined, acceptedRows: undefined, rejectedRows: undefined, duplicateRows: undefined }));
      const { unmount } = renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");
      await waitFor(() => expect(screen.getByText("Analisando o arquivo…")).toBeInTheDocument());
      unmount();
    }
  });

  it("PREVIEW_READY reports partial success honestly (accepted/rejected/duplicate), never all-or-nothing", async () => {
    mockAsRole("OWNER");
    mockGetJob(job({ status: "PREVIEW_READY" }));
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText("Pré-visualizar e deduplicar")).toBeInTheDocument());
    expect(screen.getByText(/7 de 10 linhas válidas/)).toBeInTheDocument();
    expect(screen.getByText(/2 linhas correspondem a um Fornecedor já existente/)).toBeInTheDocument();
    expect(screen.getByText(/nunca atualiza um Fornecedor existente/)).toBeInTheDocument();
    expect(screen.getByText(/1 linha com erro de validação será ignorada/)).toBeInTheDocument();
  });

  it("VIEWER on PREVIEW_READY sees the counts but no write actions at all", async () => {
    mockAsRole("VIEWER");
    mockGetJob(job({ status: "PREVIEW_READY" }));
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText("Pré-visualizar e deduplicar")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Confirmar importação" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
  });

  it("Confirmar importação POSTs the real commit route with If-Match, then the button disappears (COMMITTING has no PREVIEW_READY button to double-click)", async () => {
    mockAsRole("OWNER");
    mockGetJob(job({ status: "PREVIEW_READY", version: 5 }));
    postMock.mockResolvedValue({});
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar importação" })).toBeInTheDocument());
    // After the mutation succeeds, the invalidated query refetches - simulate the job having
    // moved on to COMMITTING by the time that refetch lands.
    mockGetJob(job({ status: "COMMITTING", version: 6 }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/imports/job-1/commit", undefined, { expectedVersion: 5 }));
    await waitFor(() => expect(screen.getByText("Importando…")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Confirmar importação" })).not.toBeInTheDocument();
  });

  it("COMMITTED shows the aggregate result and a link to Fornecedores, and the summary stays reachable at the same persistent URL", async () => {
    mockAsRole("OWNER");
    mockGetJob(job({ status: "COMMITTED", acceptedRows: 7, duplicateRows: 2, rejectedRows: 1 }));
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText(/Importação concluída/)).toBeInTheDocument());
    expect(screen.getByText(/7 fornecedores processados, 2 duplicata\(s\) ignorada\(s\), 1 linha\(s\) ignorada\(s\) por erro/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver Fornecedores" })).toHaveAttribute("href", "/app/org-1/subjects");
  });

  it("FAILED during parsing (never reached preview - totalRows undefined) offers 'Enviar outro arquivo', never 'Tentar novamente' on the same job", async () => {
    mockAsRole("OWNER");
    mockGetJob(
      job({ status: "FAILED", failureReason: "TOO_MANY_ROWS", totalRows: undefined, acceptedRows: undefined, rejectedRows: undefined, duplicateRows: undefined }),
    );
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/O arquivo excede o limite de 5\.000 linhas/));
    expect(screen.getByRole("link", { name: "Enviar outro arquivo" })).toHaveAttribute("href", "/app/org-1/imports/new");
  });

  it("FAILED during commit (reached preview - totalRows defined) never offers a literal retry of the same job (no backend endpoint supports it) - it explains the honest workaround instead", async () => {
    mockAsRole("OWNER");
    mockGetJob(job({ status: "FAILED", failureReason: "ENTITLEMENT_EXCEEDED", lastCommittedRowNumber: 3, acceptedRows: 7 }));
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/limite de Fornecedores do seu plano foi atingido/));
    // Codex round 1 fix: compares against totalRows (10, from the base fixture), never
    // acceptedRows - lastCommittedRowNumber and acceptedRows are different units (a row
    // position vs. a count) and mixing them can render a nonsensical "over 100%".
    expect(screen.getByText(/Última linha do arquivo alcançada antes da falha: 3 de 10/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enviar novamente" })).toHaveAttribute("href", "/app/org-1/imports/new");
    expect(screen.getByText(/já criadas serão detectadas como duplicatas/)).toBeInTheDocument();
  });

  it("a NOT_FOUND job id shows an honest unavailable state, not a crash", async () => {
    mockAsRole("OWNER");
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockRejectedValue(new ApiError({ code: "IMPORT_JOB_NOT_FOUND", category: "NOT_FOUND", message: "ImportJob not found.", retryable: false }));
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText("Esta importação não foi encontrada.")).toBeInTheDocument());
  });
});

describe("ImportWizard — UPLOADED never shows the editable mapping form (Codex round 1, real race)", () => {
  it("UPLOADED renders as the same 'processing' wait as PARSING, for every role - never the mapping form, even for a WRITE role", async () => {
    // Every job created via `POST /imports` already has `columnMapping` populated
    // (`DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING`) - the S3-triggered parse worker races to claim
    // `UPLOADED -> PARSING` the instant the upload lands. Rendering an editable mapping form
    // here would risk a client mapping submission winning that race and permanently orphaning
    // the job in `UPLOADED` (see `stepIdForJob`'s own header comment) - so this state must
    // collapse into the same safe "please wait" view PARSING gets, never its own writable step.
    for (const role of ["OWNER", "MEMBER", "VIEWER"] as MembershipRole[]) {
      mockAsRole(role);
      mockGetJob(job({ status: "UPLOADED", totalRows: undefined, acceptedRows: undefined, rejectedRows: undefined, duplicateRows: undefined }));
      const { unmount } = renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");
      await waitFor(() => expect(screen.getByText("Analisando o arquivo…")).toBeInTheDocument());
      expect(screen.queryByText("Mapear colunas")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pré-visualizar" })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("ImportWizard — EXPIRED renders an honest terminal state, never a crash", () => {
  it("shows the expired notice with no actions", async () => {
    mockAsRole("OWNER");
    mockGetJob(job({ status: "EXPIRED" }));
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText("Este job de importação expirou.")).toBeInTheDocument());
  });
});

describe("ImportWizard — mapping step (AWAITING_MAPPING only - see the UPLOADED-safety describe above)", () => {
  function mockSchema(overrides: Partial<{ headers: string[] }> = {}) {
    getMock.mockImplementation((path: string) => {
      if (path === "/imports/job-1")
        return Promise.resolve({ job: job({ status: "AWAITING_MAPPING", totalRows: undefined, acceptedRows: undefined, rejectedRows: undefined, duplicateRows: undefined }) });
      if (path === "/import-jobs/job-1/schema") {
        return Promise.resolve({
          targetEntityType: "TrackedSubject",
          fields: [
            { field: "displayName", required: true },
            { field: "type", required: true },
            { field: "externalId", required: false },
          ],
          headers: overrides.headers ?? ["displayName", "type", "externalId"],
          sampleRows: [["Acme", "VENDOR", "ext-1"]],
          objectETag: "etag-1",
        });
      }
      return Promise.reject(new Error("unexpected GET " + path));
    });
  }

  it("auto-detects a matching mapping and enables Pré-visualizar with no warning when every required field is detected", async () => {
    mockAsRole("OWNER");
    mockSchema();
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeEnabled());
    expect(screen.queryByText(/coluna.*obrigatória.*sem mapeamento/)).not.toBeInTheDocument();
  });

  it("warns about a required field with no detected column, AND blocks Pré-visualizar (Codex round 1, real finding: an unconfirmed fallback value must not submit silently)", async () => {
    mockAsRole("OWNER");
    mockSchema({ headers: ["nome", "tipo"] }); // neither matches "displayName"/"type" case-insensitively
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText(/colunas obrigatórias sem mapeamento/)).toBeInTheDocument());
    expect(screen.getByText((_, element) => element?.tagName === "P" && /"Nome".*"Tipo"/.test(element.textContent ?? ""))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeDisabled();

    // Explicitly choosing a real header for both required fields confirms them and unblocks it.
    fireEvent.change(screen.getByLabelText(/^Nome \(coluna do CSV\)/), { target: { value: "nome" } });
    fireEvent.change(screen.getByLabelText(/^Tipo \(coluna do CSV\)/), { target: { value: "tipo" } });
    expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeEnabled();
  });

  it("zero real headers (degenerate/empty CSV) leaves Pré-visualizar permanently disabled, never a silent submit with an empty column reference", async () => {
    mockAsRole("OWNER");
    mockSchema({ headers: [] });
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText(/colunas obrigatórias sem mapeamento/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeDisabled();
  });

  it("a mapping conflict (two fields mapped to the same header) is flagged inline and blocks Pré-visualizar", async () => {
    mockAsRole("OWNER");
    mockSchema({ headers: ["displayName", "type"] });
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeEnabled());

    const typeSelect = screen.getByLabelText(/^Tipo \(coluna do CSV\)/);
    fireEvent.change(typeSelect, { target: { value: "displayName" } });

    // Both rows involved in the conflict are flagged inline (spec: "sinalizado inline na
    // própria linha do grid"), never just the aggregate top-level warning.
    expect(await screen.findAllByText("Esta coluna já está mapeada para outro campo.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeDisabled();
  });

  it("Pré-visualizar submits the real mapping route with If-Match, sending only non-empty optional fields", async () => {
    mockAsRole("OWNER");
    mockSchema();
    postMock.mockResolvedValue({ status: "PARSING" });
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Pré-visualizar" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Pré-visualizar" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/import-jobs/job-1/mapping",
        { columnMapping: { schemaVersion: 1, targetKind: "TrackedSubject", columns: { displayName: "displayName", type: "type", externalId: "externalId" } } },
        { expectedVersion: 3 },
      ),
    );
  });

  it("Voltar restarts a fresh upload at /imports/new, never resumes the mapping-only job", async () => {
    mockAsRole("OWNER");
    mockSchema();
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/app/org-1/imports/new"));
  });

  it("VIEWER sees the current mapping read-only, with no selects and no submit button", async () => {
    mockAsRole("VIEWER");
    mockSchema();
    renderAtRoute("/imports/:jobId", <ImportWizard />, "/imports/job-1");

    await waitFor(() => expect(screen.getByText("Mapeamento aplicado a este arquivo (somente leitura):")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Pré-visualizar" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/coluna do CSV/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Mapeamento de colunas" })).getByText("displayName")).toBeInTheDocument();
  });
});
