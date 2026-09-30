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
 * sometimes", it stays 5 total. "Satisfeito" keeps the neutral (not green) tone
 * `presentRequirementDocStatus` already assigns it deliberately - `StatusBadge.tsx`'s own header
 * comment: a recorded evidence link is not a proof of compliance, never a stronger visual claim
 * than the data supports.
 *
 * "Fornecedor" filter dropdown (item 18, protótipo `OmniVence-requisitos-prototipo.html`,
 * 2026-09-30): built entirely CLIENT-SIDE over the hits the 5 status queries already fetch -
 * `searchRequirements` still has no `subjectId` parameter, so this is not a new backend call, just
 * a filter (+ the option list itself) derived from `RequirementSearchHit.requirement.subjectId`/
 * `subjectDisplayName`, tenant-wide view only (the nested Hub do Fornecedor view is already
 * scoped to one fornecedor). "Tipo de documento" filter from the same prototype is still NOT
 * built - the `Requirement` domain type has no document-type field anywhere (`src/api/types.ts`),
 * it would be a fabricated filter over data that doesn't exist.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, Pencil, Trash2, FileCheck2, RotateCw } from "lucide-react";
import { useOrgPath } from "../routing/useOrgPath.js";
import { useRequirementsSearch } from "../hooks/useRequirementsSearch.js";
import { useRequirementsForSubject } from "../hooks/useRequirementsForSubject.js";
import { useCreateRequirement } from "../hooks/useCreateRequirement.js";
import { useUpdateRequirement } from "../hooks/useUpdateRequirement.js";
import { useDeleteRequirement } from "../hooks/useDeleteRequirement.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { useSubjectsDashboard } from "../hooks/useSubjectsDashboard.js";
import { InitialLoading, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { OmniHero } from "../components/OmniHero.js";
import { DataTable, type DataTableGroup } from "../components/ui/DataTable.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { PageHeader, Panel, Section, Toolbar, ToolbarSpacer } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { IconButton } from "../components/ui/IconButton.js";
import { Dialog } from "../components/ui/Dialog.js";
import { Combobox } from "../components/ui/Combobox.js";
import { RequirementDetail } from "./subjects/RequirementDetail.js";
import { TextField } from "../components/forms/TextField.js";
import { SelectField } from "../components/forms/SelectField.js";
import { FormErrorSummary } from "../components/forms/FormErrorSummary.js";
import { ApiError, isConflict } from "../api/errors.js";
import { presentRequirementDocStatus, formatAbsoluteDate } from "../api/presentation.js";
import type { Requirement, RequirementApplicability, RequirementSearchHit, RequirementStatus, TrackedSubject } from "../api/types.js";
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

// `searchRequirements` (tenant-wide, used whenever `!filterSubjectId`) returns
// `RequirementSearchHit[]` (`{kind, requirement, subjectDisplayName}`), never a bare
// `Requirement[]` - only the per-subject route does. `RequirementRow` is the one shape both
// branches normalize into below, so the table doesn't need to special-case its source.
interface RequirementRow {
  requirement: Requirement;
  subjectDisplayName?: string;
}

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
  const [supplierFilter, setSupplierFilter] = useState("");
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
    return <InitialLoading label="Carregando requisitos…" size="page" />;
  }
  if (isFullyError) {
    const first = allQueries[0];
    const message = first?.error instanceof ApiError ? first.error.message : "Não foi possível carregar os requisitos.";
    return <ErrorState message={message} onRetry={() => allQueries.forEach((q) => void q.refetch())} />;
  }

  let requirements: RequirementRow[];
  if (filterSubjectId) {
    let subjectRequirements = subjectQuery.data?.requirements ?? [];
    if (statusTab !== "ALL") subjectRequirements = subjectRequirements.filter((r) => r.status === statusTab);
    if (searchTerm.trim()) {
      const needle = searchTerm.trim().toLowerCase();
      subjectRequirements = subjectRequirements.filter((r) => r.name.toLowerCase().includes(needle));
    }
    requirements = subjectRequirements.map((requirement) => ({ requirement }));
  } else {
    let hits = isAll ? queriesList.flatMap((q) => q.data?.items ?? []) : (statusQueries[statusTab].data?.items ?? []);
    if (supplierFilter) hits = hits.filter((hit) => hit.requirement.subjectId === supplierFilter);
    requirements = hits.map((hit: RequirementSearchHit) => ({ requirement: hit.requirement, subjectDisplayName: hit.subjectDisplayName }));
  }
  // Option list for the "Fornecedor" filter select: derived from ALL 5 status queries (never just
  // the active tab/current supplier selection) so switching status tabs doesn't shrink the list of
  // fornecedores the user can filter by - same convention as the prototype, whose own `<select>`
  // rebuilds its options from the full unfiltered `items` array.
  const supplierOptions = filterSubjectId
    ? []
    : Array.from(
        queriesList
          .flatMap((q) => q.data?.items ?? [])
          .reduce<Map<string, string>>((map, hit) => {
            if (!map.has(hit.requirement.subjectId)) map.set(hit.requirement.subjectId, hit.subjectDisplayName ?? hit.requirement.subjectId);
            return map;
          }, new Map()),
      )
        .map(([subjectId, label]) => ({ subjectId, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  // Item 37 (spec §3/§6): "Requisitos (N)" no hub do fornecedor é sempre o TOTAL sem busca - antes
  // desta correção, a anotação usava `requirements.length` (já filtrado por busca), então digitar
  // na busca mudava o total exibido no título da seção, contradizendo a regra explícita da spec
  // ("a busca não altera... o total global"). O contador de resultados filtrados vive à parte,
  // junto do campo de busca.
  const subjectTotalCount = filterSubjectId ? (subjectQuery.data?.requirements.length ?? 0) : undefined;

  // Tenant-wide view only: grouped by fornecedor instead of one flat 28-row table repeating the
  // same requirement names per fornecedor (real UX finding, Marcelo 2026-09-27) - nested (already
  // single-fornecedor) stays flat, `DataTable`'s own grouped mode already handles the header row/
  // count/a11y (same mechanism `ItemsCollection.tsx` uses for "Vencidos"/"Vence em breve").
  const groups: DataTableGroup<RequirementRow>[] | undefined = filterSubjectId
    ? undefined
    : Object.values(
        requirements.reduce<Record<string, DataTableGroup<RequirementRow>>>((acc, row) => {
          const id = row.requirement.subjectId;
          const group = (acc[id] ??= { id, label: row.subjectDisplayName ?? row.requirement.subjectId, rows: [] });
          group.rows.push(row);
          return acc;
        }, {}),
      ).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return (
    <div className="ov-requirements">
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
        <>
          <PageHeader
            title="Requisitos documentais"
            above={<span className="ov-eyebrow">Conformidade documental</span>}
            description={filterSubjectId ? "Requisitos de documento deste fornecedor." : "Requisitos de documento, com evidência vinculada, em toda a organização."}
            actions={canWrite ? <Button variant="primary" icon={Plus} onClick={() => setShowCreate((v) => !v)}>Novo requisito</Button> : undefined}
          />
          {/* Banner roxo (protótipo `expiration-tracker-requisitos-documentais.html`, Marcelo
              2026-09-27) - mesmo `OmniHero` já usado por Vencimentos/Fornecedores/Membros/
              Atividade, só que ainda faltava aqui. Só na visão tenant-wide: dentro do hub do
              fornecedor o `SubjectLayout` já tem o seu próprio cabeçalho/hero. */}
          <OmniHero
            icon={FileCheck2}
            eyebrow="Conformidade em dia"
            title="Cada exigência, com evidência rastreável."
            description="Acompanhe o que está em falta, pendente ou satisfeito para cada fornecedor, num só lugar."
            summary={<><strong>{totalCount}{anyScanLimitReached ? "+" : ""}</strong><span>{totalCount === 1 ? "requisito" : "requisitos"}</span></>}
          />
        </>
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
        <Section heading="Visão por situação" headingId="requirements-status-view">
        <div className="requirements-metrics" role="group" aria-labelledby="requirements-status-view">
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
        </Section>
      )}
      {filterSubjectId ? (
        <Panel padded>
          {/* Hint deliberately generic, never a specific example document name (Marcelo,
              2026-09-22, achado real de CI): "Ex.: Certidão Negativa de Débitos." collided in
              strict mode with an e2e fixture using that exact real-sounding name on this same
              page (E2E-B3-07, block3-subjects-requirements.spec.ts) - getByText("Certidão
              Negativa de Débitos") matched both the hint and the actual row. */}
          <TextField
            id="requirements-search"
            label="Buscar por nome do requisito"
            value={searchTerm}
            onChange={setSearchTerm}
            hint="Vazio mostra todos os requisitos."
          />
          {searchTerm.trim() ? (
            <p aria-live="polite" className="u-text-secondary requirements-search-result-count">
              {requirements.length} {requirements.length === 1 ? "resultado" : "resultados"} para &quot;{searchTerm.trim()}&quot;
            </p>
          ) : null}
        </Panel>
      ) : (
        // Reconciliação visual 2026-09-29: busca + Atualizar num Toolbar só na visão tenant-wide,
        // mesma convenção de `ItemsCollection.tsx`/`SubjectsCollection.tsx` - o modo aninhado
        // mantém o campo isolado (acima) porque o Hub do Fornecedor não tem "Atualizar" em
        // nenhuma tela irmã aninhada (D-339).
        <Toolbar>
          <TextField id="requirements-search" label="Buscar por nome" hideLabel value={searchTerm} onChange={setSearchTerm} placeholder="Buscar por nome" />
          <label className="u-visually-hidden" htmlFor="requirements-supplier-filter">
            Filtrar por fornecedor
          </label>
          <select id="requirements-supplier-filter" className="requirements-supplier-filter" value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
            <option value="">Todos os fornecedores</option>
            {supplierOptions.map((option) => (
              <option key={option.subjectId} value={option.subjectId}>
                {option.label}
              </option>
            ))}
          </select>
          <ToolbarSpacer />
          <span className="requirements-result-count" aria-live="polite">
            {requirements.length} {requirements.length === 1 ? "requisito" : "requisitos"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCw}
            disabled={queriesList.some((q) => q.isFetching)}
            onClick={() => queriesList.forEach((q) => void q.refetch())}
          >
            {queriesList.some((q) => q.isFetching) ? "Atualizando…" : "Atualizar"}
          </Button>
        </Toolbar>
      )}
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
              rowKey={(r: RequirementRow) => r.requirement.requirementId}
              rows={groups ? undefined : requirements}
              groups={groups}
              columns={[
            {
              key: "name",
              header: "Requisito",
              primary: true,
              // D-339 achado 1: o nome abria o FORNECEDOR (mesmo destino de um clique errado) - o
              // requisito já tem um destino próprio; o nome agora abre esse destino diretamente
              // (a ação "Ver" que fazia a mesma coisa foi removida por ser redundante). O
              // fornecedor não aparece mais nesta célula: fora do contexto de um fornecedor a
              // linha já mora dentro do grupo com o nome dele no cabeçalho; dentro do contexto
              // (`filterSubjectId`) a página inteira (SubjectLayout) já o mostra.
              render: (r) => (
                <Button variant="tertiary" size="sm" onClick={() => openRequirement(r.requirement)}>
                  {r.requirement.name}
                </Button>
              ),
            },
            { key: "status", header: "Status", render: (r) => <StatusBadge presentation={presentRequirementDocStatus(r.requirement.status)} /> },
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
                r.requirement.evidenceValidUntil ? (
                  r.requirement.evidenceDocumentId ? (
                    <Link to={orgPath(`/documents/${r.requirement.evidenceDocumentId}`)}>{formatAbsoluteDate(r.requirement.evidenceValidUntil)}</Link>
                  ) : (
                    formatAbsoluteDate(r.requirement.evidenceValidUntil)
                  )
                ) : (
                  "—"
                ),
            },
            {
              key: "actions",
              header: "Ações",
              actions: true,
              render: (r) => (canWrite ? <RowActions requirement={r.requirement} /> : null),
            },
          ]}
            />
          )}
          {/* Rodapé de contagem só tenant-wide (reconciliação visual 2026-09-29, mesma convenção
              de `ov-items-footer`/`ov-subjects-footer`) - a anotação "(N)" do heading acima
              permanece para os dois modos, o teste do modo aninhado depende dela. */}
          {!filterSubjectId && requirements.length > 0 ? (
            <p className="ov-requirements-footer" aria-live="polite">
              {requirements.length} {requirements.length === 1 ? "requisito" : "requisitos"} nesta visualização
            </p>
          ) : null}
        </Panel>
      </Section>
    </div>
  );
}

// Real UX fix (Marcelo, 2026-09-27): row actions now match `SubjectsCollection.tsx`'s own
// pattern (icon-only `IconButton`s, a real `Dialog` for the destructive confirmation) instead of
// this screen's own earlier, different-looking text buttons + a bare `role="alertdialog"` span.
function RowActions({ requirement }: { requirement: Requirement }) {
  const deleteMutation = useDeleteRequirement(requirement.subjectId, requirement.requirementId);
  const [action, setAction] = useState<"edit" | "delete">();
  const [deleteError, setDeleteError] = useState<string | undefined>();

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ expectedVersion: requirement.version });
      setAction(undefined);
    } catch (err) {
      if (isConflict(err)) return;
      setDeleteError(err instanceof ApiError ? err.message : "Não foi possível excluir este requisito.");
    }
  }

  return (
    <>
      <span className="ov-requirements-actions">
        <IconButton size="sm" variant="tertiary" label={`Editar ${requirement.name}`} onClick={() => setAction("edit")}>
          <Pencil size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          size="sm"
          variant="danger"
          label={`Excluir ${requirement.name}`}
          onClick={() => {
            setDeleteError(undefined);
            setAction("delete");
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      </span>
      {action === "edit" ? <EditRequirementForm requirement={requirement} onClose={() => setAction(undefined)} /> : null}
      {action === "delete" ? (
        <Dialog title="Excluir requisito?" variant="alertdialog" onClose={() => (deleteMutation.isPending ? undefined : setAction(undefined))}>
          <p>O requisito &quot;{requirement.name}&quot; será excluído permanentemente. Esta ação não pode ser desfeita.</p>
          <Button variant="secondary" disabled={deleteMutation.isPending} onClick={() => setAction(undefined)}>
            Cancelar
          </Button>{" "}
          <Button variant="danger" pending={deleteMutation.isPending} onClick={() => void handleDelete()}>
            Excluir
          </Button>
          {/* Holistic frontend review finding: a conflict on delete used to `return` silently in
              `handleDelete` above, never rendering anything - the same class of gap already fixed
              for SubjectsCollection.tsx's archive/reactivate action (Codex Block 3 round 1 finding 12). */}
          {deleteMutation.isConflict ? <p role="alert">Este requisito foi alterado por outra pessoa — atualize a página antes de tentar excluir de novo.</p> : null}
          {deleteError ? <p role="alert">{deleteError}</p> : null}
        </Dialog>
      ) : null}
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
    <Dialog title="Editar requisito" onClose={onClose}>
      <form className="ui-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
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
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" pending={mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
          <Button type="button" variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreateRequirementForm({ onClose, defaultSubjectId }: { onClose: () => void; defaultSubjectId?: string }) {
  const mutation = useCreateRequirement();
  // Real UX finding (Marcelo, 2026-09-27): a partir da coleção GLOBAL, este campo pedia o ID
  // interno do fornecedor como texto livre ("copie o ID na página do fornecedor") - o pior ponto
  // de fricção da tela, obrigando o usuário a navegar pra outro lugar só pra copiar um ULID. Um
  // `Combobox` (mesmo componente/padrão que `SubjectRequests.tsx` já usa pra "Requisito") busca
  // por nome sobre a lista real de fornecedores ativos. D-339 achado 2 continua valendo: quando
  // `defaultSubjectId` vem do contexto (dentro do Hub do fornecedor), o fornecedor nunca é um
  // campo de formulário - nem o Combobox é renderizado, só `defaultSubjectId` vai direto no payload.
  const subjectsQuery = useSubjectsDashboard("ACTIVE");
  const [selectedSubject, setSelectedSubject] = useState<TrackedSubject | null>(null);
  const [name, setName] = useState("");
  const [applicability, setApplicability] = useState<RequirementApplicability>("APPLICABLE");
  // Protótipo `OmniVence-requisitos-prototipo.html` (item 18): "Observação" opcional - o campo já
  // existe no contrato (`Requirement.notes`/`CreateRequirementInput.notes`), só nunca tinha sido
  // exposto neste formulário.
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const effectiveSubjectId = defaultSubjectId ?? selectedSubject?.subjectId;
    if (!effectiveSubjectId || !name.trim()) {
      setErrors([defaultSubjectId ? "Informe o nome do requisito." : "Escolha o fornecedor e informe o nome do requisito."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ subjectId: effectiveSubjectId, name: name.trim(), applicability, notes: notes.trim() || undefined });
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar este requisito."]);
    }
  }

  return (
    <Dialog title="Novo requisito" onClose={onClose}>
      <form className="ui-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        {defaultSubjectId ? null : (
          <Combobox
            id="req-subject"
            label="Fornecedor"
            required
            options={subjectsQuery.data?.subjects ?? []}
            value={selectedSubject}
            onChange={setSelectedSubject}
            getOptionId={(s) => s.subjectId}
            getOptionLabel={(s) => s.displayName}
            placeholder={subjectsQuery.isPending ? "Carregando fornecedores…" : "Buscar por nome"}
          />
        )}
        <TextField id="req-name" label="Nome do requisito" value={name} onChange={setName} required maxLength={120} />
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
        <TextField id="req-notes" label="Observação" value={notes} onChange={setNotes} maxLength={120} hint="Ex.: renovar anualmente." />
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" pending={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar requisito"}
          </Button>
          <Button type="button" variant="tertiary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
