/**
 * A11 — Requisitos documentais (Block 3, D-2xx), tenant-wide. Post-audit spec
 * (`docs/frontend/prototype-screen-specs/A11-requisitos.md`): this screen DOES support
 * `docarchive:requirement-create` (WRITE_ROLES) — the pre-audit spec's contradiction ("não são
 * criados aqui") was corrected. `docarchive:requirement-delete` is WRITE_ROLES, a deliberate
 * exception (not ADMIN_ROLES like most `-delete` actions) confirmed directly against
 * `authorization.ts`.
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
 *    same "operator supplies the id directly" precedent `SubjectDetail.tsx`'s legacy review flow
 *    already established for `itemId`, not a fabricated shortcut.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useOrgPath } from "../routing/useOrgPath.js";
import { useRequirementsSearch } from "../hooks/useRequirementsSearch.js";
import { useCreateRequirement } from "../hooks/useCreateRequirement.js";
import { useDeleteRequirement } from "../hooks/useDeleteRequirement.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { DataTable, CellSecondary } from "../components/ui/DataTable.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { PageHeader, Toolbar } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";
import { SelectField } from "../components/forms/SelectField.js";
import { FormErrorSummary } from "../components/forms/FormErrorSummary.js";
import { ApiError, isConflict } from "../api/errors.js";
import { presentRequirementDocStatus, formatAbsoluteDate } from "../api/presentation.js";
import type { Requirement, RequirementApplicability, RequirementStatus } from "../api/types.js";

const STATUS_TABS: { value: "ALL" | RequirementStatus; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "MISSING", label: "Em falta" },
  { value: "PENDING", label: "Pendente" },
  { value: "SATISFIED", label: "Satisfeito" },
  { value: "NOT_SATISFIED", label: "Não satisfeito" },
  { value: "NOT_APPLICABLE", label: "Não se aplica" },
];

export function RequirementsCollection() {
  const orgPath = useOrgPath();
  const [statusTab, setStatusTab] = useState<"ALL" | RequirementStatus>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";

  const singleStatus = statusTab === "ALL" ? "MISSING" : statusTab;
  const query = useRequirementsSearch(singleStatus, searchTerm || undefined);

  // "Todos" needs every status merged - fetch the other 4 only when that tab is active, each
  // its own independent query so one status's failure never blanks the others.
  const missing = useRequirementsSearch("MISSING", searchTerm || undefined);
  const pending = useRequirementsSearch("PENDING", searchTerm || undefined);
  const satisfied = useRequirementsSearch("SATISFIED", searchTerm || undefined);
  const notSatisfied = useRequirementsSearch("NOT_SATISFIED", searchTerm || undefined);
  const notApplicable = useRequirementsSearch("NOT_APPLICABLE", searchTerm || undefined);

  const allQueries = statusTab === "ALL" ? [missing, pending, satisfied, notSatisfied, notApplicable] : [query];
  const isPending = allQueries.some((q) => q.isPending);
  const isError = allQueries.every((q) => q.isError);

  if (isPending) {
    return <InitialLoading label="Carregando requisitos…" />;
  }
  if (isError) {
    const first = allQueries[0];
    const message = first?.error instanceof ApiError ? first.error.message : "Não foi possível carregar os requisitos.";
    return <ErrorState message={message} onRetry={() => allQueries.forEach((q) => void q.refetch())} />;
  }

  const requirements: Requirement[] = statusTab === "ALL" ? allQueries.flatMap((q) => q.data?.items ?? []) : (query.data?.items ?? []);

  return (
    <div>
      <PageHeader
        title="Requisitos documentais"
        description="Requisitos de documento, com evidência vinculada, em toda a organização."
        actions={canWrite ? <Button variant="secondary" onClick={() => setShowCreate((v) => !v)}>Novo requisito</Button> : undefined}
      />
      {showCreate ? <CreateRequirementForm onClose={() => setShowCreate(false)} /> : null}
      <Toolbar>
        <nav aria-label="Filtrar por status">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.value} variant={tab.value === statusTab ? "primary" : "secondary"} size="sm" aria-current={tab.value === statusTab ? "page" : undefined} onClick={() => setStatusTab(tab.value)}>
              {tab.label}
            </Button>
          ))}
        </nav>
        <TextField id="requirements-search" label="Buscar requisitos" hint="Nome do requisito" value={searchTerm} onChange={setSearchTerm} />
      </Toolbar>
      {requirements.length === 0 ? (
        <EmptyState
          kind={searchTerm ? "filtered-empty" : "true-empty"}
          message={searchTerm ? "Nenhum requisito encontrado para estes filtros." : "Nenhum requisito cadastrado ainda."}
          action={searchTerm ? <Button variant="secondary" onClick={() => setSearchTerm("")}>Limpar filtros</Button> : undefined}
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
                <>
                  <Link to={orgPath(`/subjects/${r.subjectId}`)}>{r.name}</Link>
                  <CellSecondary>{r.subjectId}</CellSecondary>
                </>
              ),
            },
            { key: "assignee", header: "Responsável", render: (r) => r.assigneeUserId ?? "Sem responsável" },
            { key: "status", header: "Status", render: (r) => <StatusBadge presentation={presentRequirementDocStatus(r.status)} /> },
            { key: "validity", header: "Validade", numeric: true, render: (r) => (r.evidenceValidUntil ? formatAbsoluteDate(r.evidenceValidUntil) : "—") },
            {
              key: "actions",
              header: "Ações",
              actions: true,
              render: (r) => (canWrite ? <RowActions requirement={r} /> : null),
            },
          ]}
        />
      )}
    </div>
  );
}

function RowActions({ requirement }: { requirement: Requirement }) {
  const deleteMutation = useDeleteRequirement(requirement.subjectId, requirement.requirementId);
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ expectedVersion: requirement.version });
      setConfirming(false);
    } catch (err) {
      if (isConflict(err)) return;
    }
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
    </span>
  ) : (
    <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
      Excluir
    </Button>
  );
}

function CreateRequirementForm({ onClose }: { onClose: () => void }) {
  const mutation = useCreateRequirement();
  const [subjectId, setSubjectId] = useState("");
  const [name, setName] = useState("");
  const [applicability, setApplicability] = useState<RequirementApplicability>("APPLICABLE");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subjectId.trim() || !name.trim()) {
      setErrors(["Informe o fornecedor (ID) e o nome do requisito."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ subjectId: subjectId.trim(), name: name.trim(), applicability });
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar este requisito."]);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <FormErrorSummary errors={errors} />
      <TextField id="req-subject-id" label="ID do fornecedor" value={subjectId} onChange={setSubjectId} required hint="Copie o ID na página do fornecedor (Hub do fornecedor)." />
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
