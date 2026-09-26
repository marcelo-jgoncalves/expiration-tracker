import { useMemo, useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2, FolderArchive, Pencil, Plus, Trash2 } from "lucide-react";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useSubjectsDashboard } from "../../hooks/useSubjectsDashboard.js";
import { useArchiveSubject } from "../../hooks/useArchiveSubject.js";
import { useDeleteSubject } from "../../hooks/useDeleteSubject.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState, BackgroundRefreshIndicator } from "../../components/AsyncStates.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentSubjectType } from "../../api/presentation.js";
import { DataTable, CellSecondary } from "../../components/ui/DataTable.js";
import { Button } from "../../components/ui/Button.js";
import { IconButton } from "../../components/ui/IconButton.js";
import { PageHeader, Panel, StatusFilter, Toolbar } from "../../components/ui/Layout.js";
import { OmniHero } from "../../components/OmniHero.js";
import { Dialog } from "../../components/ui/Dialog.js";
import { TextField } from "../../components/forms/TextField.js";
import { SubjectFormDialog } from "./SubjectForm.js";
import type { TrackedSubject, TrackedSubjectStatus } from "../../api/types.js";
import "./SubjectsCollection.css";

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
  const searchTerm = searchParams.get("search") ?? "";
  function setSearchTerm(value: string) { setSearchParams(previous => { const params = new URLSearchParams(previous); params.set("search", value); return params; }, { replace: true }); }
  useEffect(() => { document.title = "Fornecedores · OmniVence"; }, []);
  const statusParam = searchParams.get("status");
  const status: TrackedSubjectStatus = isKnownStatus(statusParam) ? statusParam : "ACTIVE";
  const [formTarget, setFormTarget] = useState<"new" | { subjectId: string } | null>(null);
  const query = useSubjectsDashboard(status);
  const activeQuery = useSubjectsDashboard("ACTIVE");
  const archivedQuery = useSubjectsDashboard("ARCHIVED");
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const canDelete = role === "OWNER" || role === "ADMIN";

  function selectStatus(next: TrackedSubjectStatus) {
    setSearchParams(previous => { const params = new URLSearchParams(previous); params.set("status", next); return params; });
  }

  const allSubjects = useMemo(() => query.data?.subjects ?? [], [query.data]);
  const filtered = useMemo(() => {
    // Risk-led ordering (spec §Estrutura item 3): pending-count first, then alphabetical — no
    // per-subject pending count is available from this backend yet (TrackedSubject carries no
    // requirement-count denormalization), so this degrades to alphabetical-only until that
    // aggregation exists (recorded as a named gap, D-2xx below).
    const sorted = [...allSubjects].sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR") || a.subjectId.localeCompare(b.subjectId));
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
    <div className="ov-subjects">
      <PageHeader
        title="Fornecedores"
        above={<span className="ov-eyebrow">Relacionamentos e conformidade</span>}
        description="Acompanhe organizações e pessoas que precisam manter a documentação em dia com você."
        actions={canWrite ? <Button variant="primary" icon={Plus} onClick={() => setFormTarget("new")}>Novo fornecedor</Button> : undefined}
      />
      <OmniHero icon={Building2} eyebrow="Rede de parceiros" title="Todos os relacionamentos, em um só lugar." description="Encontre rapidamente quem precisa da sua atenção e mantenha cada cadastro organizado."
        summary={<><strong>{activeQuery.data?.subjects.length.toLocaleString("pt-BR") ?? "?"}</strong><span>cadastros ativos carregados</span></>} />
      <div className="ov-subjects-heading"><div><h2>Seus cadastros</h2><p>Consulte e gerencie os registros da sua organização.</p></div>
      <Toolbar>
        <StatusFilter options={STATUS_TABS.map(tab => ({ ...tab, label: tab.label + ((tab.value === "ACTIVE" ? activeQuery.data : archivedQuery.data) ? " (" + (tab.value === "ACTIVE" ? activeQuery.data : archivedQuery.data)!.subjects.length + " carregados)" : "") }))} value={status} onChange={selectStatus} />
        <div className="subjects-search">
          <TextField label="Buscar por nome ou CNPJ/identificador" hideLabel placeholder="Nome ou CNPJ/identificador" value={searchTerm} onChange={setSearchTerm} id="subjects-search" />
        </div>
        {isBackgroundRefreshing ? <BackgroundRefreshIndicator /> : null}
      </Toolbar></div>
      {allSubjects.length === 0 ? (
        <EmptyState
          kind={status === "ACTIVE" ? "true-empty" : "filtered-empty"}
          message={status === "ACTIVE" ? "Nenhum fornecedor cadastrado ainda. Cadastre o primeiro fornecedor para começar a acompanhar a documentação dele." : "Nenhum fornecedor neste status."}
          action={status === "ACTIVE" && canWrite ? <Button variant="primary" icon={Plus} onClick={() => setFormTarget("new")}>Novo fornecedor</Button> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState kind="filtered-empty" message="Nenhum resultado encontrado. Tente buscar por outro nome ou identificador." action={<Button variant="secondary" onClick={() => setSearchTerm("")}>Limpar busca</Button>} />
      ) : (
        <Panel>
          <DataTable
            caption="Fornecedores"
            rowKey={(s: TrackedSubject) => s.subjectId}
            rows={filtered}
            columns={[
              {
                key: "name",
                header: "Organização",
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
                render: (s) =>
                  s.tags.length ? (
                    <span className="ov-subject-tags">
                      {s.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="u-text-secondary">Sem tags</span>
                  ),
              },
              {
                key: "actions",
                header: "Ações",
                actions: true,
                render: (s) => <RowActions subject={s} canWrite={canWrite} canDelete={canDelete} onEdit={() => setFormTarget({ subjectId: s.subjectId })} />,
              },
            ]}
          />
          <p className="ov-subjects-footer" aria-live="polite">{filtered.length} {filtered.length === 1 ? "cadastro" : "cadastros"} nesta visualização</p>
        </Panel>
      )}
      {formTarget ? (
        <SubjectFormDialog
          subjectId={formTarget === "new" ? undefined : formTarget.subjectId}
          onClose={() => setFormTarget(null)}
        />
      ) : null}
    </div>
  );
}

function RowActions({ subject, canWrite, canDelete, onEdit }: { subject: TrackedSubject; canWrite: boolean; canDelete: boolean; onEdit: () => void }) {
  const archiveMutation = useArchiveSubject(subject.subjectId);
  const deleteMutation = useDeleteSubject(subject.subjectId);
  const [action, setAction] = useState<"archive" | "delete">();
  const [confirmation, setConfirmation] = useState("");
  const [failure, setFailure] = useState("");
  const pending = archiveMutation.isPending || deleteMutation.isPending;
  if (!canWrite) return null;

  async function confirm() {
    if (pending) return;
    setFailure("");
    try {
      if (action === "archive") await archiveMutation.mutateAsync({ expectedVersion: subject.version });
      else await deleteMutation.mutateAsync({ expectedVersion: subject.version });
      setAction(undefined);
    } catch (error) {
      setFailure(isConflict(error) ? "Este cadastro foi alterado. Atualize a lista antes de tentar novamente." : error instanceof ApiError && error.category === "BUSINESS_RULE" ? error.message : "Não foi possível concluir a ação. Tente novamente.");
    }
  }

  return <span className="ov-subject-actions">
    <IconButton size="sm" variant="tertiary" label={`Editar ${subject.displayName}`} onClick={onEdit}><Pencil size={16} aria-hidden="true" /></IconButton>
    {subject.status === "ACTIVE" && <IconButton size="sm" variant="ghost" label={`Arquivar ${subject.displayName}`} onClick={() => { setFailure(""); setAction("archive"); }}><FolderArchive size={16} aria-hidden="true" /></IconButton>}
    {canDelete && <IconButton size="sm" variant="danger" label={`Excluir ${subject.displayName}`} onClick={() => { setFailure(""); setConfirmation(""); setAction("delete"); }}><Trash2 size={16} aria-hidden="true" /></IconButton>}
    {/* alertdialog, not the default "dialog" - both actions here are irreversible ("O serviço
        atual não oferece restauração" / no undo in this interface), same destructive-confirmation
        posture as every other Dialog usage in this codebase (Reports.tsx, ...). */}
    {action && <Dialog title={action === "archive" ? "Arquivar cadastro?" : "Excluir cadastro?"} variant="alertdialog" onClose={() => { if (!pending) setAction(undefined); }}>
      <p>{action === "archive" ? `O cadastro de ${subject.displayName} sairá da lista de ativos. O serviço atual não oferece restauração.` : `O cadastro de ${subject.displayName} será marcado como excluído e deixará de aparecer nas listas. Esta ação não apaga os documentos associados e não possui restauração nesta interface.`}</p>
      <Button variant="secondary" disabled={pending} onClick={() => setAction(undefined)}>Cancelar</Button>
      {action === "delete" && <TextField label="Digite o nome do cadastro para confirmar" value={confirmation} onChange={setConfirmation} />}
      {failure && <p role="alert">{failure}</p>}
      <Button variant={action === "delete" ? "danger" : "primary"} pending={pending} disabled={action === "delete" && confirmation !== subject.displayName} onClick={() => void confirm()}>{action === "archive" ? "Arquivar" : "Excluir"}</Button>
    </Dialog>}
  </span>;
}
