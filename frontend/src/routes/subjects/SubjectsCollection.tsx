/**
 * A08 — Fornecedores (Block 3, D-2xx). Full CRUD per the post-audit spec
 * (`docs/frontend/prototype-screen-specs/A08-fornecedores.md`): search, create, edit,
 * archive/reactivate, delete — replacing the deliberately narrow BLOCKER-C read/review-only
 * surface this route used to be (see this file's own prior header comment, now superseded).
 *
 * Search is client-side over the already-fetched status-filtered list (`useSubjectsDashboard`)
 * rather than a second round-trip to `GET /subjects/search` — a real simplification versus the
 * spec's implied server search, acceptable at this tenant's real data volume (GSI7 status list,
 * not paginated) and consistent with "don't build search infra a screen doesn't need yet"
 * (mission's deferred-complexity discipline). Revisit if a tenant's subject count outgrows a
 * single unpaginated list.
 */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useSubjectsDashboard } from "../../hooks/useSubjectsDashboard.js";
import { useArchiveSubject } from "../../hooks/useArchiveSubject.js";
import { useDeleteSubject } from "../../hooks/useDeleteSubject.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState, BackgroundRefreshIndicator } from "../../components/AsyncStates.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentSubjectType } from "../../api/presentation.js";
import { DataTable, CellSecondary } from "../../components/ui/DataTable.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { PageHeader, Toolbar } from "../../components/ui/Layout.js";
import { TextField } from "../../components/forms/TextField.js";
import type { TrackedSubject, TrackedSubjectStatus } from "../../api/types.js";

const STATUS_TABS: { value: TrackedSubjectStatus; label: string }[] = [
  { value: "ACTIVE", label: "Ativos" },
  { value: "ARCHIVED", label: "Arquivados" },
];

function isKnownStatus(value: string | null): value is TrackedSubjectStatus {
  return value === "ACTIVE" || value === "ARCHIVED";
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function SubjectsCollection() {
  const orgPath = useOrgPath();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState("");
  const statusParam = searchParams.get("status");
  const status: TrackedSubjectStatus = isKnownStatus(statusParam) ? statusParam : "ACTIVE";
  const query = useSubjectsDashboard(status);
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const canDelete = role === "OWNER" || role === "ADMIN";

  function selectStatus(next: TrackedSubjectStatus) {
    setSearchParams(next === "ACTIVE" ? {} : { status: next });
  }

  const allSubjects = useMemo(() => query.data?.subjects ?? [], [query.data]);
  const filtered = useMemo(() => {
    // Risk-led ordering (spec §Estrutura item 3): pending-count first, then alphabetical — no
    // per-subject pending count is available from this backend yet (TrackedSubject carries no
    // requirement-count denormalization), so this degrades to alphabetical-only until that
    // aggregation exists (recorded as a named gap, D-2xx below).
    const sorted = [...allSubjects].sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
    if (!searchTerm.trim()) return sorted;
    const needle = normalize(searchTerm.trim());
    return sorted.filter((s) => normalize(s.displayName).includes(needle) || (s.externalId && normalize(s.externalId).includes(needle)));
  }, [allSubjects, searchTerm]);

  if (query.isPending) {
    return <InitialLoading label="Carregando fornecedores…" />;
  }

  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.category === "AUTHORIZATION") {
      return <EmptyState kind="permission-limited" />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar os fornecedores.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const isBackgroundRefreshing = query.isFetching && !query.isPending;

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        description="Terceiros que precisam manter documentação em dia com você."
        actions={canWrite ? <ButtonLink variant="primary" to={orgPath("/subjects/new")}>Novo fornecedor</ButtonLink> : undefined}
      />
      <Toolbar>
        <nav aria-label="Filtrar por status">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.value} variant={tab.value === status ? "primary" : "secondary"} size="sm" aria-current={tab.value === status ? "page" : undefined} onClick={() => selectStatus(tab.value)}>
              {tab.label}
            </Button>
          ))}
        </nav>
        <TextField label="Buscar fornecedores" hint="Nome ou CNPJ/identificador" value={searchTerm} onChange={setSearchTerm} id="subjects-search" />
        {isBackgroundRefreshing ? <BackgroundRefreshIndicator /> : null}
      </Toolbar>
      {allSubjects.length === 0 ? (
        <EmptyState
          kind={status === "ACTIVE" ? "true-empty" : "filtered-empty"}
          message={status === "ACTIVE" ? "Nenhum fornecedor cadastrado ainda. Cadastre o primeiro fornecedor para começar a acompanhar a documentação dele." : "Nenhum fornecedor neste status."}
          action={status === "ACTIVE" && canWrite ? <ButtonLink variant="primary" to={orgPath("/subjects/new")}>Novo fornecedor</ButtonLink> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState kind="filtered-empty" message={`Nenhum fornecedor encontrado para "${searchTerm}".`} action={<Button variant="secondary" onClick={() => setSearchTerm("")}>Limpar busca</Button>} />
      ) : (
        <DataTable
          caption="Fornecedores"
          rowKey={(s: TrackedSubject) => s.subjectId}
          rows={filtered}
          columns={[
            {
              key: "name",
              header: "Fornecedor",
              primary: true,
              render: (s) => (
                <>
                  <Link to={orgPath(`/subjects/${s.subjectId}`)}>{s.displayName}</Link>
                  {s.externalId ? <CellSecondary>{s.externalId}</CellSecondary> : null}
                </>
              ),
            },
            { key: "type", header: "Tipo", render: (s) => presentSubjectType(s.type) },
            {
              key: "tags",
              header: "Tags",
              render: (s) => (s.tags.length ? s.tags.slice(0, 2).join(", ") + (s.tags.length > 2 ? ` +${s.tags.length - 2}` : "") : "—"),
            },
            {
              key: "actions",
              header: "Ações",
              actions: true,
              render: (s) => <RowActions subject={s} canWrite={canWrite} canDelete={canDelete} orgPath={orgPath} />,
            },
          ]}
        />
      )}
    </div>
  );
}

function RowActions({ subject, canWrite, canDelete, orgPath }: { subject: TrackedSubject; canWrite: boolean; canDelete: boolean; orgPath: (p: string) => string }) {
  const archiveMutation = useArchiveSubject(subject.subjectId);
  const deleteMutation = useDeleteSubject(subject.subjectId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | undefined>();

  if (!canWrite) return null; // VIEWER: no row menu at all (hidden, not disabled) per RBAC table.

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ expectedVersion: subject.version });
      setConfirmingDelete(false);
    } catch (err) {
      if (isConflict(err)) return;
      const message = err instanceof ApiError ? err.message : "Não foi possível excluir este fornecedor.";
      setBlockedReason(message);
    }
  }

  return (
    <>
      <ButtonLink size="sm" variant="secondary" to={orgPath(`/subjects/${subject.subjectId}/edit`)}>
        Editar
      </ButtonLink>{" "}
      <Button
        size="sm"
        variant="secondary"
        disabled={archiveMutation.isPending}
        onClick={() =>
          archiveMutation.mutate(
            { expectedVersion: subject.version },
            {
              // A non-conflict archive/reactivate failure (authorization, validation, network)
              // must not disappear silently - only isConflict had a visible state before (Codex
              // Block 3 review round 1 finding 12).
              onError: (err) => {
                if (isConflict(err)) return;
                setBlockedReason(err instanceof ApiError ? err.message : "Não foi possível concluir esta ação.");
              },
            },
          )
        }
      >
        {subject.status === "ARCHIVED" ? "Reativar" : "Arquivar"}
      </Button>
      {canDelete ? (
        confirmingDelete ? (
          <span role="alertdialog" aria-label={`Excluir ${subject.displayName}`}>
            {" "}
            Excluir &quot;{subject.displayName}&quot; permanentemente?{" "}
            <Button size="sm" variant="danger" pending={deleteMutation.isPending} onClick={() => void handleDelete()}>
              Confirmar exclusão
            </Button>{" "}
            <Button size="sm" variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Cancelar
            </Button>
          </span>
        ) : (
          <>
            {" "}
            <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
              Excluir
            </Button>
          </>
        )
      ) : null}
      {archiveMutation.isConflict ? <span role="alert"> Este fornecedor mudou desde que a página carregou — atualize antes de tentar de novo.</span> : null}
      {blockedReason ? <span role="alert"> {blockedReason}</span> : null}
    </>
  );
}
