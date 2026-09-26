/**
 * A11 — Requisitos documentais (Block 3, D-2xx), tenant-wide. Post-audit spec
 * (`docs/frontend/prototype-screen-specs/A11-requisitos.md`): this screen DOES support
 * `docarchive:requirement-create` (WRITE_ROLES) — the pre-audit spec's contradiction ("não são
 * criados aqui") was corrected. `docarchive:requirement-delete` is WRITE_ROLES, a deliberate
 * exception (not ADMIN_ROLES like most `-delete` actions) confirmed directly against
 * `authorization.ts`.
 *
 * A09's "Requisitos documentais"/"Documentos" cards link here with `?subjectId=...` - honored
 * below via `useRequirementsForSubject` (bypasses the tenant-wide search entirely when present,
 * the real per-subject `GET .../requirements/{subjectId}` route, not a client-side filter over
 * a merged tenant-wide result) - Codex Block 3 review round 1 finding 1, the filter was
 * previously silently ignored.
 *
 * Known, named gaps (not mechanical wiring - real missing backend capability, implemented with
 * graceful degradation rather than blocking the screen, per the A02/Block-1 precedent):
 *  - `docarchive:requirement-export` (CSV) has no backend route/handler anywhere in
 *    `document-archive-handlers.ts`/`proxy-allowlist.ts` - the "Exportar CSV" action is
 *    OMITTED here rather than wired to a non-existent endpoint or shown disabled with no real
 *    affordance behind it.
 *  - Template-apply (`docarchive:requirementtemplate-apply`, opens A21) is Block 4 scope - "Ver
 *    templates" is out of scope for this screen this block; omitted rather than a dead link.
 *  - "Novo requisito" asks for a subjectId directly (no subject-name typeahead picker yet) -
 *    same "operator supplies the id directly" precedent the legacy review flow already
 *    established for `itemId`, not a fabricated shortcut.
 *  - The tenant-wide "Todos" tab merges each status's FIRST page only (`searchRequirements`'s
 *    cursor is read but not followed) - a true cursor-following aggregate would need either a
 *    dedicated backend endpoint or client-side multi-page fetching per status, out of this
 *    block's time-box. `scanLimitReached`/a partial per-status failure is surfaced explicitly
 *    (never silently dropped) rather than pretending the merged list is exhaustive (Codex Block
 *    3 review round 1, findings 2/3) - the same discipline now applies to the metric tiles below
 *    (a "+" suffix, never a bare number claiming to be exhaustive).
 *
 * Metric tiles (Marcelo, protótipo `expiration-tracker-requisitos-documentais.html`, 2026-09-22):
 * the 5 status queries below now run UNCONDITIONALLY (not just while "Todos" is active, reverting
 * the Codex Block 3 finding-14 optimization on purpose) so the tile row always has real counts to
 * show, whichever tab is selected - the previously-separate single-status `query` was folded into
 * this same set (picking the matching one for the list), so this is not simply "5 always + 1
 * sometimes", it stays 5 total. Two elements from the prototype are deliberately NOT built:
 * "Tipo de documento" filter (the `Requirement` domain type has no document-type field anywhere -
 * `src/api/types.ts` - it would be a fabricated filter over data that doesn't exist) and
 * "Fornecedor" filter dropdown (the real search contract, `searchRequirements`, has no subjectId
 * parameter - only `status`/`namePrefix`/`assigneeUserId`). "Satisfeito" keeps the neutral (not
 * green) tone `presentRequirementDocStatus` already assigns it deliberately - `StatusBadge.tsx`'s
 * own header comment: a recorded evidence link is not a proof of compliance, never a stronger
 * visual claim than the data supports.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useOrgPath } from "../routing/useOrgPath.js";
import { useRequirementsSearch } from "../hooks/useRequirementsSearch.js";
import { useRequirementsForSubject } from "../hooks/useRequirementsForSubject.js";
import { useCreateRequirement } from "../hooks/useCreateRequirement.js";
import { useUpdateRequirement } from "../hooks/useUpdateRequirement.js";
import { useDeleteRequirement } from "../hooks/useDeleteRequirement.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { DataTable, CellSecondary } from "../components/ui/DataTable.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { RequirementDetail } from "./subjects/RequirementDetail.js";
import { TextField } from "../components/forms/TextField.js";
import { SelectField } from "../components/forms/SelectField.js";
import { FormErrorSummary } from "../components/forms/FormErrorSummary.js";
import { ApiError, isConflict } from "../api/errors.js";
import { presentRequirementDocStatus, formatAbsoluteDate } from "../api/presentation.js";
import type { Requirement, RequirementApplicability, RequirementStatus } from "../api/types.js";
import "./RequirementsCollection.css";

/** "success" aqui é deliberadamente diferente do tom de `presentRequirementDocStatus` (mantido
 * `neutral` para o `StatusBadge` de cada linha - "evidência vinculada" não é prova de
 * conformidade). Pedido direto de Marcelo, 2026-09-22: os cartões-resumo (agregados, nunca a
 * badge por linha) usam vermelho/amarelo/verde sempre visíveis, não só quando selecionados. */
const STATUS_METRICS: { value: RequirementStatus; label: string; tone: "critical" | "warning" | "success" | "neutral" }[] = [
  { value: "MISSING", label: "Em falta", tone: "critical" },
  { value: "PENDING", label: "Pendente", tone: "warning" },
  { value: "SATISFIED", label: "Satisfeito", tone: "success" },
  { value: "NOT_SATISFIED", label: "Não satisfeito", tone: "critical" },
  { value: "NOT_APPLICABLE", label: "Não se aplica", tone: "neutral" },
];

export function RequirementsCollection() {
  const orgPath = useOrgPath();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // D-339 (redesenho do fluxo de detalhe de Fornecedor): este componente agora também é montado
  // como a seção "Requisitos" (índice) dentro da casca de `SubjectLayout`
  // (`/subjects/:subjectId` e `/subjects/:subjectId/requirements/:requirementId`) - `routeParams`
  // é o sinal de "estou aninhado", nunca a query string sozinha (que continua funcionando para
  // qualquer link antigo/externo que ainda a use).
  const routeParams = useParams<{ subjectId?: string; requirementId?: string }>();
  const nested = Boolean(routeParams.subjectId);
  const filterSubjectId = searchParams.get("subjectId") ?? routeParams.subjectId ?? undefined;
  const [statusTab, setStatusTab] = useState<"ALL" | RequirementStatus>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [viewingRequirement, setViewingRequirement] = useState<{ subjectId: string; requirementId: string } | null>(null);
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";

  // Aninhado: o requisito aberto vem da URL (`:requirementId`), nunca de estado local - fecha o
  // achado "RequirementDetail sem endereço próprio" (D-339, achado do Codex Rodada 1/precedente
  // já usado por `/subjects/:subjectId/series/:seriesId`). Fora da casca (rota antiga por query
  // string): mantém o overlay controlado por estado local, comportamento inalterado.
  const effectiveViewing = nested ? (routeParams.requirementId && filterSubjectId ? { subjectId: filterSubjectId, requirementId: routeParams.requirementId } : null) : viewingRequirement;

  function openRequirement(r: Requirement) {
    if (nested) navigate(orgPath(`/subjects/${r.subjectId}/requirements/${r.requirementId}`));
    else setViewingRequirement({ subjectId: r.subjectId, requirementId: r.requirementId });
  }

  function closeRequirement() {
    if (nested && filterSubjectId) navigate(orgPath(`/subjects/${filterSubjectId}`));
    else setViewingRequirement(null);
  }

  const subjectQuery = useRequirementsForSubject(filterSubjectId ?? "");

  const isAll = statusTab === "ALL";
  // All 5 run unconditionally now (see this file's header comment) - the metric tiles need real
  // counts for every status regardless of which tab is active.
  const missing = useRequirementsSearch("MISSING", searchTerm || undefined, undefined, !filterSubjectId);
  const pending = useRequirementsSearch("PENDING", searchTerm || undefined, undefined, !filterSubjectId);
  const satisfied = useRequirementsSearch("SATISFIED", searchTerm || undefined, undefined, !filterSubjectId);
  const notSatisfied = useRequirementsSearch("NOT_SATISFIED", searchTerm || undefined, undefined, !filterSubjectId);
  const notApplicable = useRequirementsSearch("NOT_APPLICABLE", searchTerm || undefined, undefined, !filterSubjectId);
  const statusQueries: Record<RequirementStatus, ReturnType<typeof useRequirementsSearch>> = {
    MISSING: missing,
    PENDING: pending,
    SATISFIED: satisfied,
    NOT_SATISFIED: notSatisfied,
    NOT_APPLICABLE: notApplicable,
  };
  const queriesList = [missing, pending, satisfied, notSatisfied, notApplicable];

  const allQueries = filterSubjectId ? [subjectQuery] : queriesList;
  const isPending = allQueries.some((q) => q.isPending);
  const isFullyError = allQueries.every((q) => q.isError);
  const failedCount = allQueries.filter((q) => q.isError).length;
  const anyScanLimitReached = !filterSubjectId && queriesList.some((q) => q.data?.scanLimitReached);
  const totalCount = queriesList.reduce((sum, q) => sum + (q.data?.items.length ?? 0), 0);

  if (isPending) {
    return <InitialLoading label="Carregando requisitos…" />;
  }
  if (isFullyError) {
    const first = allQueries[0];
    const message = first?.error instanceof ApiError ? first.error.message : "Não foi possível carregar os requisitos.";
    return <ErrorState message={message} onRetry={() => allQueries.forEach((q) => void q.refetch())} />;
  }

  let requirements: Requirement[];
  if (filterSubjectId) {
    requirements = subjectQuery.data?.requirements ?? [];
    if (statusTab !== "ALL") requirements = requirements.filter((r) => r.status === statusTab);
    if (searchTerm.trim()) {
      const needle = searchTerm.trim().toLowerCase();
      requirements = requirements.filter((r) => r.name.toLowerCase().includes(needle));
    }
  } else {
    requirements = isAll ? queriesList.flatMap((q) => q.data?.items ?? []) : (statusQueries[statusTab].data?.items ?? []);
  }
  // Item 37 (spec §3/§6): "Requisitos (N)" no hub do fornecedor é sempre o TOTAL sem busca - antes
  // desta correção, a anotação usava `requirements.length` (já filtrado por busca), então digitar
  // na busca mudava o total exibido no título da seção, contradizendo a regra explícita da spec
  // ("a busca não altera... o total global"). O contador de resultados filtrados vive à parte,
  // junto do campo de busca.
  const subjectTotalCount = filterSubjectId ? (subjectQuery.data?.requirements.length ?? 0) : undefined;

  return (
    <div>
      {/* D-339: dentro da casca do fornecedor (`nested`), o próprio `SubjectLayout` já mostra o
          nome/tipo/ações do fornecedor - um segundo cabeçalho aqui seria duplicado. Fora dela
          (rota tenant-wide antiga), o cabeçalho continua completo, sem mudança. */}
      {nested ? (
        canWrite ? (
          <p className="requirements-nested-actions">
            <Button variant="primary" icon={Plus} onClick={() => setShowCreate((v) => !v)}>Novo requisito</Button>
          </p>
        ) : null
      ) : (
        <PageHeader
          title="Requisitos documentais"
          description={filterSubjectId ? "Requisitos de documento deste fornecedor." : "Requisitos de documento, com evidência vinculada, em toda a organização."}
          actions={canWrite ? <Button variant="primary" icon={Plus} onClick={() => setShowCreate((v) => !v)}>Novo requisito</Button> : undefined}
        />
      )}
      {failedCount > 0 && !isFullyError ? (
        <InlineNotice tone="warning" announce="status">
          Não foi possível carregar {failedCount} de {allQueries.length} categorias de status — a lista abaixo está incompleta.
        </InlineNotice>
      ) : null}
      {anyScanLimitReached ? (
        <InlineNotice tone="info" announce="status">
          Mostrando um número limitado de resultados por status — refine a busca para ver itens que não aparecem aqui.
        </InlineNotice>
      ) : null}
      {showCreate ? <CreateRequirementForm defaultSubjectId={filterSubjectId} onClose={() => setShowCreate(false)} /> : null}
      {effectiveViewing ? <RequirementDetail subjectId={effectiveViewing.subjectId} requirementId={effectiveViewing.requirementId} onClose={closeRequirement} /> : null}
      {filterSubjectId ? null : (
        <div className="requirements-metrics" role="group" aria-label="Filtrar por status">
          <button
            type="button"
            className={`requirements-metric requirements-metric--accent${isAll ? " requirements-metric--active" : ""}`}
            aria-pressed={isAll}
            onClick={() => setStatusTab("ALL")}
          >
            <span className="requirements-metric__label">Todos</span>
            <span className="requirements-metric__value">
              {totalCount}
              {anyScanLimitReached ? "+" : ""}
            </span>
          </button>
          {STATUS_METRICS.map((metric) => {
            const q = statusQueries[metric.value];
            const count = q.data?.items.length ?? 0;
            return (
              <button
                key={metric.value}
                type="button"
                className={`requirements-metric requirements-metric--${metric.tone}${statusTab === metric.value ? " requirements-metric--active" : ""}`}
                aria-pressed={statusTab === metric.value}
                onClick={() => setStatusTab(metric.value)}
              >
                <span className="requirements-metric__label">{metric.label}</span>
                <span className="requirements-metric__value">
                  {count}
                  {q.data?.scanLimitReached ? "+" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <Panel padded>
        {/* Hint deliberately generic, never a specific example document name (Marcelo, 2026-09-22,
            achado real de CI): "Ex.: Certidão Negativa de Débitos." collided in strict mode with
            an e2e fixture using that exact real-sounding name on this same page
            (E2E-B3-07, block3-subjects-requirements.spec.ts) - getByText("Certidão Negativa de
            Débitos") matched both the hint and the actual row. */}
        <TextField
          id="requirements-search"
          label={filterSubjectId ? "Buscar por nome do requisito" : "Buscar por nome"}
          value={searchTerm}
          onChange={setSearchTerm}
          hint="Vazio mostra todos os requisitos."
        />
        {filterSubjectId && searchTerm.trim() ? (
          <p aria-live="polite" className="u-text-secondary requirements-search-result-count">
            {requirements.length} {requirements.length === 1 ? "resultado" : "resultados"} para &quot;{searchTerm.trim()}&quot;
          </p>
        ) : null}
      </Panel>
      <Section heading="Requisitos" headingId="requirements-list" annotation={`(${filterSubjectId ? subjectTotalCount : requirements.length})`}>
        <Panel>
          {requirements.length === 0 ? (
            // Item 37 (spec §3): dentro do hub do fornecedor, mensagens/CTA seguem o texto exato
            // da spec ("Nenhum requisito cadastrado"/"Criar primeiro requisito"/"Nenhum requisito
            // encontrado") - fora dela (coleção tenant-wide), copy original preservada.
            <EmptyState
              kind={searchTerm ? "filtered-empty" : "true-empty"}
              message={
                searchTerm
                  ? filterSubjectId
                    ? "Nenhum requisito encontrado."
                    : "Nenhum requisito encontrado para estes filtros."
                  : filterSubjectId
                    ? "Nenhum requisito cadastrado. Cadastre a primeira exigência documental para acompanhar este fornecedor."
                    : "Nenhum requisito cadastrado ainda."
              }
              action={
                searchTerm ? (
                  <Button variant="secondary" onClick={() => setSearchTerm("")}>
                    {filterSubjectId ? "Limpar busca" : "Limpar filtros"}
                  </Button>
                ) : filterSubjectId && canWrite ? (
                  <Button variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>
                    Criar primeiro requisito
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <DataTable
              caption="Requisitos documentais"
              rowKey={(r: Requirement) => r.requirementId}
              rows={requirements}
              columns={[
            {
              key: "name",
              header: "Requisito",
              primary: true,
              render: (r) => (
                // D-339 achado 1: o nome abria o FORNECEDOR (mesmo destino de um clique errado) -
                // o requisito já tem um destino próprio (o botão "Ver" mais à direita); o nome
                // agora abre o MESMO destino, nunca um recurso diferente do que anuncia. O link
                // para o fornecedor mora no identificador abaixo, onde genuinamente pertence.
                <>
                  <Button variant="tertiary" size="sm" onClick={() => openRequirement(r)}>
                    {r.name}
                  </Button>
                  <CellSecondary>
                    <Link to={orgPath(`/subjects/${r.subjectId}`)}>{r.subjectId}</Link>
                  </CellSecondary>
                </>
              ),
            },
            { key: "assignee", header: "Responsável", render: (r) => r.assigneeUserId ?? "Sem responsável" },
            { key: "status", header: "Status", render: (r) => <StatusBadge presentation={presentRequirementDocStatus(r.status)} /> },
            {
              key: "validity",
              header: "Validade",
              numeric: true,
              render: (r) =>
                // D-339 achado 3: evidência vinculada não tinha link nenhum para o documento
                // real - o dado (`evidenceDocumentId`) já existe no contrato, só nunca virou link.
                // Isto NÃO é uma coleção completa de documentos do fornecedor (achado mantido,
                // não fingido como resolvido) - só o acesso ao documento já vinculado a este
                // requisito específico.
                r.evidenceValidUntil ? (
                  r.evidenceDocumentId ? <Link to={orgPath(`/documents/${r.evidenceDocumentId}`)}>{formatAbsoluteDate(r.evidenceValidUntil)}</Link> : formatAbsoluteDate(r.evidenceValidUntil)
                ) : (
                  "—"
                ),
            },
            {
              key: "view",
              header: "",
              actions: true,
              render: (r) => (
                <Button variant="tertiary" size="sm" onClick={() => openRequirement(r)}>
                  Ver
                </Button>
              ),
            },
            {
              key: "actions",
              header: "Ações",
              actions: true,
              render: (r) => (canWrite ? <RowActions requirement={r} /> : null),
            },
          ]}
            />
          )}
        </Panel>
      </Section>
    </div>
  );
}

function RowActions({ requirement }: { requirement: Requirement }) {
  const deleteMutation = useDeleteRequirement(requirement.subjectId, requirement.requirementId);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ expectedVersion: requirement.version });
      setConfirming(false);
    } catch (err) {
      if (isConflict(err)) return;
      setDeleteError(err instanceof ApiError ? err.message : "Não foi possível excluir este requisito.");
    }
  }

  if (editing) {
    return <EditRequirementForm requirement={requirement} onClose={() => setEditing(false)} />;
  }

  return confirming ? (
    <span role="alertdialog" aria-label={`Excluir ${requirement.name}`}>
      Excluir &quot;{requirement.name}&quot; ({requirement.subjectId})?{" "}
      <Button size="sm" variant="danger" pending={deleteMutation.isPending} onClick={() => void handleDelete()}>
        Confirmar
      </Button>{" "}
      <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
        Cancelar
      </Button>
      {/* Holistic frontend review finding: a conflict on delete used to `return` silently in
          `handleDelete` above, never rendering anything - the same class of gap already fixed for
          SubjectsCollection.tsx's archive/reactivate action (Codex Block 3 round 1 finding 12). */}
      {deleteMutation.isConflict ? <span role="alert"> Este requisito foi alterado por outra pessoa — atualize a página antes de tentar excluir de novo.</span> : null}
      {deleteError ? <span role="alert"> {deleteError}</span> : null}
    </span>
  ) : (
    <>
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        Editar
      </Button>{" "}
      <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
        Excluir
      </Button>
    </>
  );
}

function EditRequirementForm({ requirement, onClose }: { requirement: Requirement; onClose: () => void }) {
  const mutation = useUpdateRequirement(requirement.subjectId, requirement.requirementId);
  const [name, setName] = useState(requirement.name);
  const [applicability, setApplicability] = useState<RequirementApplicability>(requirement.applicability);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setErrors(["Informe o nome do requisito."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ input: { name: name.trim(), applicability }, expectedVersion: requirement.version });
      onClose();
    } catch (err) {
      if (isConflict(err)) return; // surfaced by mutation.isConflict below.
      setErrors([err instanceof ApiError ? err.message : "Não foi possível salvar este requisito."]);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <FormErrorSummary errors={errors} />
      {mutation.isConflict ? <p role="alert">Este requisito mudou desde que a página carregou — atualize antes de salvar de novo.</p> : null}
      <TextField id={`req-edit-name-${requirement.requirementId}`} label="Nome do requisito" value={name} onChange={setName} required />
      <SelectField
        id={`req-edit-applicability-${requirement.requirementId}`}
        label="Aplicabilidade"
        value={applicability}
        onChange={(v) => setApplicability(v as RequirementApplicability)}
        options={[
          { value: "APPLICABLE", label: "Aplicável" },
          { value: "NOT_APPLICABLE", label: "Não se aplica" },
        ]}
      />
      <Button type="submit" variant="primary" pending={mutation.isPending}>
        {mutation.isPending ? "Salvando…" : "Salvar"}
      </Button>{" "}
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </form>
  );
}

function CreateRequirementForm({ onClose, defaultSubjectId }: { onClose: () => void; defaultSubjectId?: string }) {
  const mutation = useCreateRequirement();
  // D-339 achado 2: quando `defaultSubjectId` vem do contexto (filtro/rota de um fornecedor
  // específico), o fornecedor NUNCA é um campo de formulário editável - antes, `defaultSubjectId`
  // só pré-preenchia um `TextField` que continuava aceitando qualquer edição, permitindo trocar
  // de fornecedor silenciosamente ao criar. Fixo por construção agora: nem renderiza o campo
  // nesse caso, só usa `defaultSubjectId` direto no payload. A criação a partir da coleção
  // GLOBAL (sem fornecedor conhecido) continua exigindo o ID explícito.
  const [subjectId, setSubjectId] = useState(defaultSubjectId ?? "");
  const [name, setName] = useState("");
  const [applicability, setApplicability] = useState<RequirementApplicability>("APPLICABLE");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const effectiveSubjectId = defaultSubjectId ?? subjectId;
    if (!effectiveSubjectId.trim() || !name.trim()) {
      setErrors(["Informe o fornecedor (ID) e o nome do requisito."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ subjectId: effectiveSubjectId.trim(), name: name.trim(), applicability });
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar este requisito."]);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <FormErrorSummary errors={errors} />
      {defaultSubjectId ? null : (
        <TextField id="req-subject-id" label="ID do fornecedor" value={subjectId} onChange={setSubjectId} required hint="Copie o ID na página do fornecedor (Hub do fornecedor)." />
      )}
      <TextField id="req-name" label="Nome do requisito" value={name} onChange={setName} required />
      <SelectField
        id="req-applicability"
        label="Aplicabilidade"
        value={applicability}
        onChange={(v) => setApplicability(v as RequirementApplicability)}
        options={[
          { value: "APPLICABLE", label: "Aplicável" },
          { value: "NOT_APPLICABLE", label: "Não se aplica" },
        ]}
      />
      <Button type="submit" variant="primary" pending={mutation.isPending}>
        {mutation.isPending ? "Criando…" : "Criar requisito"}
      </Button>{" "}
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </form>
  );
}
