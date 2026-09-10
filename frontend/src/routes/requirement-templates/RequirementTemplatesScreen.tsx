/**
 * A21 — Templates de requisitos (Block 4, D-2xx). One screen, two stacked panels (catalog above,
 * detail below — never side-by-side, per the audited spec), mounted at both
 * `/settings/requirement-templates` and `/settings/requirement-templates/:templateId` (selecting
 * a row updates the URL via `navigate(path, { replace: true })` — the app's real equivalent of
 * the spec's `history.replaceState` note: no full navigation/remount, same URL-reflects-selection
 * contract, expressed through the existing `useOrgPath`/react-router convention this codebase
 * already uses everywhere else rather than a raw DOM History API call).
 *
 * **Three RBAC tiers** (the audit's own correction, verified directly against
 * `authorization.ts`):
 *  - `docarchive:requirementtemplate-read` — READ_ONLY_ROLES: every role browses the catalog and
 *    opens any template's detail, including ARCHIVED, read-only.
 *  - `docarchive:requirementtemplate-apply` — WRITE_ROLES: "Aplicar a fornecedor" (never VIEWER).
 *  - `docarchive:requirementtemplate-*` (create/update/duplicate/archive/unarchive) —
 *    ADMIN_ROLES: catalog administration, including duplicating an ARCHIVED template — the exact
 *    contradiction the audit fixed (previously non-admins could "duplicate for reference").
 *
 * Item reorder (▲/▼, ADMIN+, only while `ACTIVE`) is a REAL backend capability, unlike A20's
 * metadata fields: `RequirementTemplateItem` carries `position`, and `updateRequirementTemplate`
 * replaces the whole `items` array wholesale (verified directly in
 * `document-archive-service.ts`) — reordering is implemented as a full-array update in the new
 * order, position derived from array index, never a fabricated dedicated endpoint.
 */
import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./RequirementTemplates.css";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useRequirementTemplates } from "../../hooks/useRequirementTemplates.js";
import { useRequirementTemplate } from "../../hooks/useRequirementTemplate.js";
import { useCreateRequirementTemplate } from "../../hooks/useCreateRequirementTemplate.js";
import { useUpdateRequirementTemplate } from "../../hooks/useUpdateRequirementTemplate.js";
import { useDuplicateRequirementTemplate } from "../../hooks/useDuplicateRequirementTemplate.js";
import { useArchiveRequirementTemplate } from "../../hooks/useArchiveRequirementTemplate.js";
import { useUnarchiveRequirementTemplate } from "../../hooks/useUnarchiveRequirementTemplate.js";
import { usePreviewTemplateApplication } from "../../hooks/usePreviewTemplateApplication.js";
import { useApplyTemplate } from "../../hooks/useApplyTemplate.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { DataTable, CellSecondary } from "../../components/ui/DataTable.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { PageHeader, Section } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError } from "../../api/errors.js";
import { presentRequirementTemplateStatus } from "../../api/presentation.js";
import type { RequirementTemplate, TemplateApplicationPreview } from "../../api/types.js";

export function RequirementTemplatesScreen() {
  const { templateId } = useParams<{ templateId: string }>();
  const orgPath = useOrgPath();
  const navigate = useNavigate();
  const role = useCurrentMembershipRole();
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const canApply = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const [showCreate, setShowCreate] = useState(false);

  const activeQuery = useRequirementTemplates("ACTIVE");
  const archivedQuery = useRequirementTemplates("ARCHIVED");
  const queries = [activeQuery, archivedQuery];
  const isPending = queries.some((q) => q.isPending);
  const isFullyError = queries.every((q) => q.isError);

  if (isPending) {
    return <InitialLoading label="Carregando templates de requisitos…" />;
  }
  if (isFullyError) {
    const first = queries[0];
    const message = first?.error instanceof ApiError ? first.error.message : "Não foi possível carregar os templates.";
    return <ErrorState message={message} onRetry={() => queries.forEach((q) => void q.refetch())} />;
  }

  const templates = [...(activeQuery.data?.requirementTemplates ?? []), ...(archivedQuery.data?.requirementTemplates ?? [])];
  // Default selection: the URL's :templateId, else the first catalog row (spec's example data:
  // "Seleção padrão ao carregar: tpl1", generalized to "first row" for real data).
  const selectedId = templateId ?? templates[0]?.templateId;

  function selectTemplate(id: string) {
    navigate(orgPath(`/settings/requirement-templates/${id}`), { replace: true });
  }

  return (
    <div>
      <PageHeader
        title="Templates de requisitos"
        description="Checklists reutilizáveis de Requisitos, aplicáveis a um fornecedor de uma vez."
        actions={isAdmin ? <Button variant="primary" onClick={() => setShowCreate((v) => !v)}>Novo template</Button> : undefined}
      />
      {showCreate ? <CreateTemplateForm onClose={() => setShowCreate(false)} onCreated={selectTemplate} /> : null}
      {templates.length === 0 ? (
        <EmptyState kind="true-empty" message="Nenhum template cadastrado ainda." />
      ) : (
        <Section heading="Catálogo" headingId="template-catalog-heading" annotation={`(${templates.length})`}>
          <DataTable
            caption="Catálogo de templates de requisitos"
            rowKey={(t: RequirementTemplate) => t.templateId}
            rows={templates}
            columns={[
              {
                key: "name",
                header: "Template",
                primary: true,
                render: (t) => (
                  <Button variant="ghost" size="sm" aria-current={t.templateId === selectedId ? "true" : undefined} onClick={() => selectTemplate(t.templateId)}>
                    {t.displayName}
                  </Button>
                ),
              },
              { key: "status", header: "Status", render: (t) => <StatusBadge presentation={presentRequirementTemplateStatus(t.status)} /> },
              { key: "items", header: "Itens", numeric: true, render: (t) => t.items.length },
            ]}
          />
        </Section>
      )}
      {selectedId ? (
        <TemplateDetailPanel templateId={selectedId} isAdmin={isAdmin} canApply={canApply} />
      ) : null}
    </div>
  );
}

function CreateTemplateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const mutation = useCreateRequirementTemplate();
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim()) {
      setErrors(["Informe o nome do template."]);
      return;
    }
    setErrors([]);
    try {
      const result = await mutation.mutateAsync({ displayName: displayName.trim(), items: [] });
      onClose();
      onCreated(result.requirementTemplate.templateId);
    } catch (err) {
      if (err instanceof ApiError && err.category === "CONFLICT") {
        setErrors(["Já existe um template com este nome."]);
        return;
      }
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar este template."]);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <FormErrorSummary errors={errors} />
      <TextField id="template-name" label="Nome do template" value={displayName} onChange={setDisplayName} required hint="Pode ser salvo sem itens (rascunho válido) - itens são adicionados depois, no detalhe do template." />
      <Button type="submit" variant="primary" pending={mutation.isPending}>
        {mutation.isPending ? "Criando…" : "Criar template"}
      </Button>{" "}
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </form>
  );
}

function TemplateDetailPanel({ templateId, isAdmin, canApply }: { templateId: string; isAdmin: boolean; canApply: boolean }) {
  const query = useRequirementTemplate(templateId);
  const updateMutation = useUpdateRequirementTemplate(templateId);
  const [reorderError, setReorderError] = useState<string | undefined>();
  const [showApply, setShowApply] = useState(false);

  if (query.isPending) {
    return <InitialLoading label="Carregando template…" />;
  }
  if (query.isError) {
    const message = query.error instanceof ApiError ? query.error.message : "Não foi possível carregar este template.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const template = query.data.requirementTemplate;
  const isArchived = template.status === "ARCHIVED";
  const items = [...template.items].sort((a, b) => a.position - b.position);

  async function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);
    setReorderError(undefined);
    try {
      await updateMutation.mutateAsync({
        input: { items: reordered.map((item) => ({ name: item.name, notes: item.notes, applicability: item.applicability })) },
        expectedVersion: template.version,
      });
    } catch (err) {
      if (updateMutation.isConflict) return;
      setReorderError(err instanceof ApiError ? err.message : "Não foi possível reordenar os itens.");
    }
  }

  return (
    <Section
      heading={template.displayName}
      headingId="template-detail-heading"
      annotation={<StatusBadge presentation={presentRequirementTemplateStatus(template.status)} />}
    >
      {isArchived ? <InlineNotice tone="neutral">Template arquivado — somente leitura para não-admins.</InlineNotice> : null}
      {items.length === 0 ? (
        <p>Nenhum item neste template ainda.</p>
      ) : (
        <ul className="template-item-list">
          {items.map((item, index) => (
            <li key={item.templateItemId} className="template-item-card">
              <strong>{item.name}</strong>
              {item.notes ? <CellSecondary>{item.notes}</CellSecondary> : null}
              {" — "}
              {item.applicability === "NOT_APPLICABLE" ? "Não se aplica" : "Todos os fornecedores"}
              {" — posição "}
              {index + 1}
              {isAdmin && !isArchived ? (
                <span>
                  {" "}
                  {/* `secondary`, not `ghost` (WCAG 1.4.3 contrast, real defect the E2E a11y
                      probe caught): `ghost`'s link-colored text measured 3:1 against this
                      surface, below the 4.5:1 small-text requirement. `secondary`'s bordered,
                      higher-contrast text is correct here anyway - reorder is a real mutating
                      control, not a soft/text-link-styled action like Editar/Arquivar. */}
                  <Button size="sm" variant="secondary" aria-label={`Mover "${item.name}" para cima`} disabled={index === 0 || updateMutation.isPending} onClick={() => void moveItem(index, -1)}>
                    ▲
                  </Button>
                  <Button size="sm" variant="secondary" aria-label={`Mover "${item.name}" para baixo`} disabled={index === items.length - 1 || updateMutation.isPending} onClick={() => void moveItem(index, 1)}>
                    ▼
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {updateMutation.isConflict ? <p role="alert">Este template foi alterado por outra pessoa — recarregue antes de tentar de novo.</p> : null}
      {reorderError ? <p role="alert">{reorderError}</p> : null}
      <CellSecondary>v{template.version}</CellSecondary>
      <div className="template-actions">
        {isAdmin ? <AdminActions template={template} /> : null}
        {canApply ? (
          <Button
            variant="primary"
            disabled={items.length === 0 || isArchived}
            title={items.length === 0 ? "Adicione ao menos um item antes de aplicar" : undefined}
            onClick={() => setShowApply(true)}
          >
            Aplicar a fornecedor
          </Button>
        ) : null}
      </div>
      {showApply ? <ApplyTemplateFlow template={template} onClose={() => setShowApply(false)} /> : null}
    </Section>
  );
}

function AdminActions({ template }: { template: RequirementTemplate }) {
  const archiveMutation = useArchiveRequirementTemplate(template.templateId);
  const unarchiveMutation = useUnarchiveRequirementTemplate(template.templateId);
  const duplicateMutation = useDuplicateRequirementTemplate(template.templateId);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isArchived = template.status === "ARCHIVED";
  const toggleMutation = isArchived ? unarchiveMutation : archiveMutation;

  async function handleToggle() {
    setError(undefined);
    try {
      await toggleMutation.mutateAsync({ expectedVersion: template.version });
    } catch (err) {
      if (toggleMutation.isConflict) return;
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar este template.");
    }
  }

  return (
    <div>
      <Button variant="secondary" disabled={isArchived} title={isArchived ? "Reative o template antes de editar" : undefined}>
        Editar
      </Button>{" "}
      <Button variant="secondary" onClick={() => setShowDuplicate((v) => !v)}>
        Duplicar
      </Button>{" "}
      <Button variant="ghost" pending={toggleMutation.isPending} onClick={() => void handleToggle()}>
        {isArchived ? "Reativar" : "Arquivar"}
      </Button>
      {toggleMutation.isConflict ? <span role="alert"> Este template foi alterado por outra pessoa — recarregue antes de tentar de novo.</span> : null}
      {error ? <span role="alert"> {error}</span> : null}
      {showDuplicate ? <DuplicateTemplateForm mutation={duplicateMutation} onClose={() => setShowDuplicate(false)} /> : null}
    </div>
  );
}

function DuplicateTemplateForm({ mutation, onClose }: { mutation: ReturnType<typeof useDuplicateRequirementTemplate>; onClose: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim()) {
      setErrors(["Informe o nome da cópia."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ displayName: displayName.trim() });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.category === "CONFLICT") {
        setErrors(["Já existe um template com este nome."]);
        return;
      }
      setErrors([err instanceof ApiError ? err.message : "Não foi possível duplicar este template."]);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <FormErrorSummary errors={errors} />
      <TextField id="duplicate-name" label="Nome da cópia" value={displayName} onChange={setDisplayName} required hint="A cópia é sempre criada Ativa, na versão v1, independente do original." />
      {/* "Confirmar duplicação", not a second "Duplicar" - the panel already has a "Duplicar"
          button that opens this form; a same-named submit button next to it is ambiguous for
          anyone navigating by accessible name (screen reader rotor, browser find-in-page),
          not only for the E2E test that first caught it. */}
      <Button type="submit" variant="primary" pending={mutation.isPending}>
        {mutation.isPending ? "Duplicando…" : "Confirmar duplicação"}
      </Button>{" "}
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </form>
  );
}

function ApplyTemplateFlow({ template, onClose }: { template: RequirementTemplate; onClose: () => void }) {
  const previewMutation = usePreviewTemplateApplication(template.templateId);
  const applyMutation = useApplyTemplate(template.templateId);
  const [subjectId, setSubjectId] = useState("");
  const [preview, setPreview] = useState<TemplateApplicationPreview | undefined>();
  const [previewError, setPreviewError] = useState<string | undefined>();
  const [applyError, setApplyError] = useState<string | undefined>();
  const [confirmed, setConfirmed] = useState<{ created: number; skipped: number } | undefined>();

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subjectId.trim()) {
      setPreviewError("Informe o ID do fornecedor.");
      return;
    }
    setPreviewError(undefined);
    setConfirmed(undefined);
    try {
      const result = await previewMutation.mutateAsync({ subjectId: subjectId.trim() });
      setPreview(result);
    } catch (err) {
      setPreviewError(err instanceof ApiError ? err.message : "Não foi possível pré-visualizar a aplicação deste template.");
    }
  }

  async function handleConfirm() {
    setApplyError(undefined);
    try {
      const result = await applyMutation.mutateAsync({ subjectId: subjectId.trim(), expectedTemplateVersion: preview?.templateVersion });
      setConfirmed({ created: result.created.length, skipped: result.skipped.length });
      setPreview(undefined);
    } catch (err) {
      // A network/timeout UNKNOWN_OUTCOME here is exactly the spec's "partial application
      // conflict" - retrying is safe (never duplicates: the planner re-observes anything the
      // first attempt actually created as DUPLICATE_NAME), so the retry affordance below simply
      // re-invokes handleConfirm rather than a separate "resume" flow.
      setApplyError(err instanceof ApiError ? err.message : "Não foi possível confirmar a aplicação. Alguns itens podem já ter sido criados.");
    }
  }

  const allDuplicates = preview !== undefined && preview.create.length === 0 && preview.skip.length > 0;

  return (
    <div role="region" aria-label="Aplicar template a fornecedor">
      <form onSubmit={(event) => void handlePreview(event)} noValidate>
        <FormErrorSummary errors={previewError ? [previewError] : []} />
        <TextField id="apply-subject-id" label="ID do fornecedor" value={subjectId} onChange={setSubjectId} required hint="Copie o ID na página do fornecedor (Hub do fornecedor)." />
        <Button type="submit" variant="secondary" pending={previewMutation.isPending}>
          {previewMutation.isPending ? "Carregando…" : "Pré-visualizar aplicação"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
      {confirmed ? (
        <InlineNotice tone="success" announce="status">
          {confirmed.created} requisito(s) criado(s), {confirmed.skipped} ignorado(s) por duplicidade de nome.
        </InlineNotice>
      ) : null}
      {applyError ? (
        <InlineNotice tone="warning" announce="alert" actions={<Button variant="secondary" pending={applyMutation.isPending} onClick={() => void handleConfirm()}>Tentar novamente apenas os pendentes</Button>}>
          {applyError}
        </InlineNotice>
      ) : null}
      {preview ? (
        <DataTable
          caption="Preview de aplicação do template"
          rowKey={(row: { key: string }) => row.key}
          rows={[
            ...preview.create.map((item) => ({ key: `c-${item.templateItemId}`, name: item.name, outcome: "NOVO" as const })),
            ...preview.skip.map((item) => ({ key: `s-${item.templateItemId}`, name: item.name, outcome: "DUPLICATE_NAME" as const })),
          ]}
          columns={[
            { key: "name", header: "Item", primary: true, render: (row) => row.name },
            {
              key: "outcome",
              header: "Resultado",
              render: (row) =>
                row.outcome === "NOVO" ? (
                  <StatusBadge presentation={{ label: "Novo", tone: "neutral" }} />
                ) : (
                  <StatusBadge presentation={{ label: "Já existe um requisito com este nome neste fornecedor — será ignorado", tone: "warning" }} />
                ),
            },
          ]}
        />
      ) : null}
      {preview ? (
        <Button
          variant="primary"
          pending={applyMutation.isPending}
          disabled={allDuplicates}
          title={allDuplicates ? "Nenhum item novo a aplicar." : undefined}
          onClick={() => void handleConfirm()}
        >
          {applyMutation.isPending ? "Aplicando…" : "Confirmar aplicação"}
        </Button>
      ) : null}
    </div>
  );
}
