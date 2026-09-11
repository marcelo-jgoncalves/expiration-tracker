/**
 * A10 — Rastreamento legado (Legacy Tracked Requirements), Block 7 (D-267). Domain facts
 * verified directly against the backend (`src/modules/subject/domain/requirement-assignment.ts`,
 * `document-request-service.ts`): a `RequirementAssignment`'s `status` (MISSING/SATISFIED) is a
 * manually-frozen snapshot, changed ONLY by linking/unlinking an `ExpirationItem` here — creating
 * or resolving a `DocumentRequest`/`DocumentSubmission` never touches it. The detail page below is
 * therefore a Snapshot (frozen) + Timeline (live events) composition, never a plain form.
 *
 * Real, confirmed deviations from the audited spec (investigated directly, never silent):
 *
 *  1. **No chasing-occurrence data anywhere in the timeline.** There is no HTTP route to read
 *     `DocumentChasingOccurrence` (confirmed: no handler in `src/modules/subject/http/` references
 *     it). The spec's "Lembrete automático agendado/enviado" timeline entries are OMITTED — never
 *     fabricated placeholder data.
 *  2. **The list's "Atividade recente" column cannot show per-request/submission status.** That
 *     would require fetching each assignment's `DocumentRequest` history individually (a real
 *     N+1 — no bulk/tenant-wide endpoint exists), which no other list screen in this codebase does
 *     either. The column instead shows `updatedAt` ("Última atividade"), a real field already on
 *     the list response — the full per-request/submission timeline is only ever shown on the
 *     detail page (one assignment, one real fetch). The list's sort/priority is simplified to
 *     match: MISSING first (by `updatedAt` desc), then SATISFIED (by `updatedAt` desc) — the
 *     spec's 4-tier "submission awaiting review first" ordering needs the same per-request data
 *     this column cannot show at list scale.
 *  3. **"Vincular item" is NOT scoped to the same Subject.** `requirement-service.ts#linkExpirationItem`
 *     only checks `itemLookup.itemExists(tenantId, itemId)` — tenant-wide, no Subject/assignment
 *     scoping at all, and no "already linked elsewhere" exclusion either. No subject-scoped item
 *     search route exists. The combobox below sources from `useItemsDashboardBounded("ACTIVE")`
 *     (the same real, tenant-wide capability Overview already uses) — an honest match to what the
 *     backend can actually enforce, not the spec's aspirational subject-scoped search.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useSubject } from "../../hooks/useSubject.js";
import { useRequirementAssignments } from "../../hooks/useRequirementAssignments.js";
import { useRequirementAssignment } from "../../hooks/useRequirementAssignment.js";
import { useAssignRequirement } from "../../hooks/useAssignRequirement.js";
import { useUpdateRequirementAssignment } from "../../hooks/useUpdateRequirementAssignment.js";
import { useDeleteRequirementAssignment } from "../../hooks/useDeleteRequirementAssignment.js";
import { useLinkExpirationItem } from "../../hooks/useLinkExpirationItem.js";
import { useUnlinkExpirationItem } from "../../hooks/useUnlinkExpirationItem.js";
import { useCreateLegacyDocumentRequest } from "../../hooks/useCreateLegacyDocumentRequest.js";
import { useRevokeLegacyDocumentRequest } from "../../hooks/useRevokeLegacyDocumentRequest.js";
import { useLegacyDocumentRequests } from "../../hooks/useLegacyDocumentRequests.js";
import { useDocumentSubmissions } from "../../hooks/useDocumentSubmissions.js";
import { useItemsDashboardBounded } from "../../hooks/useItemsDashboard.js";
import { useItem } from "../../hooks/useItem.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { useToast } from "../../components/Toast.js";
import { InitialLoading, CollectionSkeleton, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { PageHeader, Section, Panel } from "../../components/ui/Layout.js";
import { DataTable, CellSecondary, type DataTableColumn } from "../../components/ui/DataTable.js";
import { Button } from "../../components/ui/Button.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { Dialog } from "../../components/ui/Dialog.js";
import { Combobox } from "../../components/ui/Combobox.js";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentRequirementStatus, presentLegacyDocumentRequestStatus, presentSubmissionStatus, formatAbsoluteDate } from "../../api/presentation.js";
import type { ExpirationItem, LegacyDocumentRequest, RequirementAssignment } from "../../api/types.js";

const WRITE_ROLES: ReadonlySet<string> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<string> = new Set(["OWNER", "ADMIN"]);

export function Tracking() {
  const { subjectId = "", assignmentId } = useParams<{ subjectId: string; assignmentId?: string }>();
  return assignmentId ? <TrackingDetail subjectId={subjectId} assignmentId={assignmentId} /> : <TrackingList subjectId={subjectId} />;
}

function sortAssignments(assignments: RequirementAssignment[]): RequirementAssignment[] {
  const rank = (a: RequirementAssignment) => (a.status === "MISSING" ? 0 : 1);
  return [...assignments].sort((a, b) => rank(a) - rank(b) || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

function TrackingList({ subjectId }: { subjectId: string }) {
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const canWrite = role !== undefined && WRITE_ROLES.has(role);
  const canAdmin = role !== undefined && ADMIN_ROLES.has(role);
  const { showToast } = useToast();

  const subjectQuery = useSubject(subjectId);
  const assignmentsQuery = useRequirementAssignments(subjectId);

  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [editing, setEditing] = useState<RequirementAssignment | undefined>();
  const [deleting, setDeleting] = useState<RequirementAssignment | undefined>();
  const [linking, setLinking] = useState<RequirementAssignment | undefined>();
  const [unlinking, setUnlinking] = useState<RequirementAssignment | undefined>();
  const [requesting, setRequesting] = useState<RequirementAssignment | undefined>();

  if (subjectQuery.isPending) return <InitialLoading label="Carregando fornecedor…" />;
  if (subjectQuery.isError) {
    const message = subjectQuery.error instanceof ApiError ? subjectQuery.error.message : "Não foi possível carregar este fornecedor.";
    return <ErrorState message={message} onRetry={() => void subjectQuery.refetch()} />;
  }
  const subject = subjectQuery.data.subject;
  const assignments = sortAssignments(assignmentsQuery.data?.assignments ?? []);

  return (
    <div>
      <PageHeader
        above={<Link to={orgPath(`/subjects/${subjectId}`)}>← Voltar para {subject.displayName}</Link>}
        title="Rastreamento legado"
        description={`${subject.displayName} · vínculos MISSING/SATISFIED do mecanismo antigo de acompanhamento — ver "Requisitos documentais" para o mecanismo atual.`}
        actions={
          canWrite ? (
            <Button variant="secondary" onClick={() => setShowAssignDialog(true)}>
              Novo vínculo legado
            </Button>
          ) : undefined
        }
      />
      <InlineNotice tone="neutral">Este é o mecanismo antigo de acompanhamento. Novos requisitos devem ser criados em Requisitos documentais.</InlineNotice>

      {assignmentsQuery.isPending ? (
        <CollectionSkeleton rows={3} label="Carregando vínculos…" />
      ) : assignmentsQuery.isError ? (
        <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void assignmentsQuery.refetch()}>Tentar novamente</Button>}>
          Não foi possível carregar os vínculos legados.
        </InlineNotice>
      ) : assignments.length === 0 ? (
        <EmptyState
          kind="true-empty"
          message="Nenhum vínculo legado registrado. Vínculos legados existem apenas para fornecedores migrados do mecanismo antigo — novos requisitos devem ser criados em Requisitos documentais."
          action={<Link to={orgPath(`/requirements?subjectId=${encodeURIComponent(subjectId)}`)}>Ir para Requisitos documentais</Link>}
        />
      ) : (
        <Panel>
          <AssignmentsTable
            assignments={assignments}
            orgPath={orgPath}
            subjectId={subjectId}
            canWrite={canWrite}
            canAdmin={canAdmin}
            onLink={setLinking}
            onUnlink={setUnlinking}
            onRequest={setRequesting}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        </Panel>
      )}

      {showAssignDialog ? <AssignDialog subjectId={subjectId} onClose={() => setShowAssignDialog(false)} showToast={showToast} /> : null}
      {editing ? <EditDialog subjectId={subjectId} assignment={editing} onClose={() => setEditing(undefined)} showToast={showToast} /> : null}
      {deleting ? <DeleteDialog subjectId={subjectId} assignment={deleting} onClose={() => setDeleting(undefined)} showToast={showToast} /> : null}
      {linking ? <LinkItemDialog subjectId={subjectId} assignment={linking} onClose={() => setLinking(undefined)} showToast={showToast} /> : null}
      {unlinking ? <UnlinkItemDialog subjectId={subjectId} assignment={unlinking} onClose={() => setUnlinking(undefined)} showToast={showToast} /> : null}
      {requesting ? <RequestDocumentDialog subjectId={subjectId} assignment={requesting} onClose={() => setRequesting(undefined)} showToast={showToast} /> : null}
    </div>
  );
}

function AssignmentsTable({
  assignments,
  orgPath,
  subjectId,
  canWrite,
  canAdmin,
  onLink,
  onUnlink,
  onRequest,
  onEdit,
  onDelete,
}: {
  assignments: RequirementAssignment[];
  orgPath: (path: string) => string;
  subjectId: string;
  canWrite: boolean;
  canAdmin: boolean;
  onLink: (a: RequirementAssignment) => void;
  onUnlink: (a: RequirementAssignment) => void;
  onRequest: (a: RequirementAssignment) => void;
  onEdit: (a: RequirementAssignment) => void;
  onDelete: (a: RequirementAssignment) => void;
}) {
  const columns: DataTableColumn<RequirementAssignment>[] = [
    {
      key: "requirement",
      header: "Vínculo",
      primary: true,
      render: (a) => (
        <>
          <Link to={orgPath(`/subjects/${subjectId}/tracking/${a.assignmentId}`)}>{a.requirementName}</Link>
          {a.notes ? <CellSecondary>{a.notes}</CellSecondary> : null}
        </>
      ),
    },
    { key: "status", header: "Status", render: (a) => <StatusBadge presentation={presentRequirementStatus(a.status)} /> },
    {
      key: "linkedItem",
      header: "Item vinculado",
      render: (a) => (a.linkedItemId ? <LinkedItemCell itemId={a.linkedItemId} orgPath={orgPath} /> : <span className="u-text-attention">Nenhum item vinculado</span>),
    },
    { key: "updatedAt", header: "Última atividade", numeric: true, render: (a) => formatAbsoluteDate(a.updatedAt) },
    {
      key: "actions",
      header: "Ações",
      actions: true,
      render: (a) => (
        <>
          <Link to={orgPath(`/subjects/${subjectId}/tracking/${a.assignmentId}`)}>Ver</Link>
          {canWrite ? (
            <>
              {" "}
              {a.status === "MISSING" ? (
                <Button size="sm" variant="ghost" onClick={() => onLink(a)}>
                  Vincular item
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onUnlink(a)}>
                  Desvincular item
                </Button>
              )}{" "}
              <Button size="sm" variant="ghost" onClick={() => onRequest(a)}>
                Solicitar documento
              </Button>{" "}
              <Button size="sm" variant="ghost" onClick={() => onEdit(a)}>
                Editar
              </Button>
            </>
          ) : null}
          {canAdmin ? (
            <>
              {" "}
              <Button size="sm" variant="danger" onClick={() => onDelete(a)}>
                Excluir vínculo
              </Button>
            </>
          ) : null}
        </>
      ),
    },
  ];

  return <DataTable caption="Vínculos legados" columns={columns} rows={assignments} rowKey={(a) => a.assignmentId} />;
}

function LinkedItemCell({ itemId, orgPath }: { itemId: string; orgPath: (path: string) => string }) {
  const itemQuery = useItem(itemId);
  if (itemQuery.isPending) return <CellSecondary>Carregando…</CellSecondary>;
  if (itemQuery.isError) return <span className="u-text-attention">Item vinculado não está mais disponível</span>;
  const item = itemQuery.data.item;
  return (
    <>
      <Link to={orgPath(`/items/${itemId}`)}>{item.name}</Link>
      <CellSecondary>{formatAbsoluteDate(item.dueDate)}</CellSecondary>
    </>
  );
}

function AssignDialog({ subjectId, onClose, showToast }: { subjectId: string; onClose: () => void; showToast: (message: string) => void }) {
  const mutation = useAssignRequirement(subjectId);
  const [requirementName, setRequirementName] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requirementName.trim()) {
      setErrors(["Informe o nome do vínculo."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ requirementName: requirementName.trim(), notes: notes.trim() || undefined });
      showToast("Vínculo criado");
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar o vínculo."]);
    }
  }

  return (
    <Dialog title="Novo vínculo legado" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        <TextField id="assign-name" label="Nome do vínculo" value={requirementName} onChange={setRequirementName} required />
        <TextField id="assign-notes" label="Notas" value={notes} onChange={setNotes} hint="Opcional." />
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Criando…" : "Criar vínculo"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

function EditDialog({ subjectId, assignment, onClose, showToast }: { subjectId: string; assignment: RequirementAssignment; onClose: () => void; showToast: (message: string) => void }) {
  const mutation = useUpdateRequirementAssignment(subjectId, assignment.assignmentId);
  const [requirementName, setRequirementName] = useState(assignment.requirementName);
  const [notes, setNotes] = useState(assignment.notes ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setConflict(false);
    try {
      await mutation.mutateAsync({ requirementName: requirementName.trim(), notes: notes.trim() || undefined, expectedVersion: assignment.version });
      showToast("Vínculo atualizado");
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        setConflict(true);
        return;
      }
      setErrors([err instanceof ApiError ? err.message : "Não foi possível atualizar o vínculo."]);
    }
  }

  return (
    <Dialog title="Editar vínculo" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        {conflict ? (
          <InlineNotice tone="warning" announce="alert">
            Este vínculo foi alterado por outra pessoa. Feche este formulário e abra "Editar" novamente para ver os valores atuais.
          </InlineNotice>
        ) : null}
        <TextField id="edit-name" label="Nome do vínculo" value={requirementName} onChange={setRequirementName} required />
        <TextField id="edit-notes" label="Notas" value={notes} onChange={setNotes} hint="Opcional." />
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Salvando…" : "Salvar"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ subjectId, assignment, onClose, showToast }: { subjectId: string; assignment: RequirementAssignment; onClose: () => void; showToast: (message: string) => void }) {
  const mutation = useDeleteRequirementAssignment(subjectId, assignment.assignmentId);
  const [error, setError] = useState<string | undefined>();

  async function handleConfirm() {
    setError(undefined);
    try {
      await mutation.mutateAsync({ expectedVersion: assignment.version });
      showToast("Vínculo excluído");
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        setError("Este vínculo foi alterado por outra pessoa. Recarregue a lista antes de excluir.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não foi possível excluir o vínculo.");
    }
  }

  return (
    <Dialog title="Excluir vínculo" variant="alertdialog" onClose={onClose}>
      <p>
        Excluir o vínculo &quot;{assignment.requirementName}&quot;? Esta ação não pode ser desfeita — o vínculo deixará de aparecer na lista e não poderá mais receber novas
        solicitações.
      </p>
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
      <Button variant="secondary" onClick={onClose}>
        Cancelar
      </Button>{" "}
      <Button variant="danger" pending={mutation.isPending} onClick={() => void handleConfirm()}>
        {mutation.isPending ? "Excluindo…" : "Confirmar exclusão"}
      </Button>
    </Dialog>
  );
}

function LinkItemDialog({ subjectId, assignment, onClose, showToast }: { subjectId: string; assignment: RequirementAssignment; onClose: () => void; showToast: (message: string) => void }) {
  const itemsQuery = useItemsDashboardBounded("ACTIVE");
  const mutation = useLinkExpirationItem(subjectId, assignment.assignmentId);
  const [item, setItem] = useState<ExpirationItem | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) {
      setErrors(["Selecione um item de vencimento."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ itemId: item.itemId, expectedVersion: assignment.version });
      showToast("Item vinculado");
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        setErrors(["Este vínculo foi alterado por outra pessoa. Feche e reabra para ver os valores atuais."]);
        return;
      }
      setErrors([err instanceof ApiError ? err.message : "Não foi possível vincular o item."]);
    }
  }

  return (
    <Dialog title="Vincular item" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        {itemsQuery.isError ? (
          <InlineNotice tone="critical" announce="alert">
            Não foi possível carregar os itens de vencimento.
          </InlineNotice>
        ) : (
          <Combobox
            label="Item de vencimento"
            required
            options={itemsQuery.data?.items ?? []}
            value={item}
            onChange={setItem}
            getOptionId={(i) => i.itemId}
            getOptionLabel={(i) => i.name}
            emptyMessage="Nenhum item encontrado."
          />
        )}
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Vinculando…" : "Vincular"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

function UnlinkItemDialog({ subjectId, assignment, onClose, showToast }: { subjectId: string; assignment: RequirementAssignment; onClose: () => void; showToast: (message: string) => void }) {
  const mutation = useUnlinkExpirationItem(subjectId, assignment.assignmentId);
  const [error, setError] = useState<string | undefined>();

  async function handleConfirm() {
    setError(undefined);
    try {
      await mutation.mutateAsync({ expectedVersion: assignment.version });
      showToast("Item desvinculado");
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        setError("Este vínculo foi alterado por outra pessoa. Recarregue antes de desvincular.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não foi possível desvincular o item.");
    }
  }

  return (
    <Dialog title="Desvincular item" onClose={onClose}>
      <p>Desvincular o item de vencimento de &quot;{assignment.requirementName}&quot;? O status voltará para MISSING.</p>
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
      <Button variant="secondary" onClick={onClose}>
        Cancelar
      </Button>{" "}
      <Button variant="primary" pending={mutation.isPending} onClick={() => void handleConfirm()}>
        {mutation.isPending ? "Desvinculando…" : "Confirmar"}
      </Button>
    </Dialog>
  );
}

function RequestDocumentDialog({ subjectId, assignment, onClose, showToast }: { subjectId: string; assignment: RequirementAssignment; onClose: () => void; showToast: (message: string) => void }) {
  const mutation = useCreateLegacyDocumentRequest(subjectId, assignment.assignmentId);
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setErrors(["Informe o e-mail do destinatário."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ recipientEmail: email.trim() });
      showToast("Solicitação criada");
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar a solicitação."]);
    }
  }

  return (
    <Dialog title="Solicitar documento" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        <TextField id="request-email" label="Destinatário" value={email} onChange={setEmail} required hint="E-mail que receberá o link de convidado." />
        <InlineNotice tone="neutral">Um link de convidado sem login será gerado e enviado a este e-mail.</InlineNotice>
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Solicitando…" : "Solicitar"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

// --- Detail (Snapshot + Timeline) ------------------------------------------------------------

function TrackingDetail({ subjectId, assignmentId }: { subjectId: string; assignmentId: string }) {
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const canWrite = role !== undefined && WRITE_ROLES.has(role);
  const canAdmin = role !== undefined && ADMIN_ROLES.has(role);
  const { showToast } = useToast();

  const detailQuery = useRequirementAssignment(subjectId, assignmentId);
  const requestsQuery = useLegacyDocumentRequests(subjectId, assignmentId);

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [requesting, setRequesting] = useState(false);

  if (detailQuery.isPending) return <InitialLoading label="Carregando vínculo…" />;
  if (detailQuery.isError) {
    const message = detailQuery.error instanceof ApiError ? detailQuery.error.message : "Não foi possível carregar este vínculo.";
    return <ErrorState message={message} onRetry={() => void detailQuery.refetch()} />;
  }
  const assignment = detailQuery.data.assignment;

  return (
    <div>
      <PageHeader
        above={<Link to={orgPath(`/subjects/${subjectId}/tracking`)}>← Voltar para Rastreamento legado</Link>}
        title={assignment.requirementName}
        actions={
          <>
            {canWrite ? (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Editar
                </Button>{" "}
                {assignment.status === "MISSING" ? (
                  <Button variant="secondary" onClick={() => setLinking(true)}>
                    Vincular item
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setUnlinking(true)}>
                    Desvincular item
                  </Button>
                )}{" "}
                <Button variant="secondary" onClick={() => setRequesting(true)}>
                  Solicitar documento
                </Button>{" "}
              </>
            ) : null}
            {canAdmin ? (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Excluir vínculo
              </Button>
            ) : null}
          </>
        }
      />

      <SnapshotBlock assignment={assignment} orgPath={orgPath} />

      <Section heading="Histórico" headingId="timeline-heading">
        {requestsQuery.isPending ? (
          <CollectionSkeleton rows={2} label="Carregando histórico…" />
        ) : requestsQuery.isError ? (
          <InlineNotice tone="warning" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void requestsQuery.refetch()}>Tentar novamente</Button>}>
            Não foi possível carregar o histórico de solicitações.
          </InlineNotice>
        ) : requestsQuery.data.requests.length === 0 ? (
          <p>Nenhuma solicitação emitida ainda.</p>
        ) : (
          <Timeline subjectId={subjectId} requests={requestsQuery.data.requests} canWrite={canWrite} showToast={showToast} />
        )}
      </Section>

      {editing ? <EditDialog subjectId={subjectId} assignment={assignment} onClose={() => setEditing(false)} showToast={showToast} /> : null}
      {deleting ? <DeleteDialogWithRedirect subjectId={subjectId} assignment={assignment} onClose={() => setDeleting(false)} showToast={showToast} /> : null}
      {linking ? <LinkItemDialog subjectId={subjectId} assignment={assignment} onClose={() => setLinking(false)} showToast={showToast} /> : null}
      {unlinking ? <UnlinkItemDialog subjectId={subjectId} assignment={assignment} onClose={() => setUnlinking(false)} showToast={showToast} /> : null}
      {requesting ? <RequestDocumentDialog subjectId={subjectId} assignment={assignment} onClose={() => setRequesting(false)} showToast={showToast} /> : null}
    </div>
  );
}

/** A10's own header comment (item §Regras de negócio) - excluding a vínculo from its OWN detail
 * page needs to navigate back to the list on success, unlike the list's `DeleteDialog` which
 * just closes in place. */
function DeleteDialogWithRedirect({ subjectId, assignment, onClose, showToast }: { subjectId: string; assignment: RequirementAssignment; onClose: () => void; showToast: (message: string) => void }) {
  const orgPath = useOrgPath();
  const mutation = useDeleteRequirementAssignment(subjectId, assignment.assignmentId);
  const [error, setError] = useState<string | undefined>();

  async function handleConfirm() {
    setError(undefined);
    try {
      await mutation.mutateAsync({ expectedVersion: assignment.version });
      showToast("Vínculo excluído");
      window.location.assign(orgPath(`/subjects/${subjectId}/tracking`));
    } catch (err) {
      if (isConflict(err)) {
        setError("Este vínculo foi alterado por outra pessoa. Recarregue a página antes de excluir.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não foi possível excluir o vínculo.");
    }
  }

  return (
    <Dialog title="Excluir vínculo" variant="alertdialog" onClose={onClose}>
      <p>Excluir o vínculo &quot;{assignment.requirementName}&quot;? Esta ação não pode ser desfeita.</p>
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
      <Button variant="secondary" onClick={onClose}>
        Cancelar
      </Button>{" "}
      <Button variant="danger" pending={mutation.isPending} onClick={() => void handleConfirm()}>
        {mutation.isPending ? "Excluindo…" : "Confirmar exclusão"}
      </Button>
    </Dialog>
  );
}

function SnapshotBlock({ assignment, orgPath }: { assignment: RequirementAssignment; orgPath: (path: string) => string }) {
  return (
    <div className="ui-panel" style={{ background: "var(--color-surface-subtle, #f6f6f6)" }}>
      <StatusBadge presentation={presentRequirementStatus(assignment.status)} />
      <p>Última atualização manual: {formatAbsoluteDate(assignment.satisfiedAt ?? assignment.createdAt)}</p>
      <p>
        Este status não muda automaticamente quando uma solicitação ou submissão avança — é atualizado apenas quando alguém vincula ou desvincula um item de vencimento aqui.
      </p>
      {assignment.linkedItemId ? <SnapshotLinkedItem itemId={assignment.linkedItemId} orgPath={orgPath} /> : null}
    </div>
  );
}

function SnapshotLinkedItem({ itemId, orgPath }: { itemId: string; orgPath: (path: string) => string }) {
  const itemQuery = useItem(itemId);
  if (itemQuery.isPending) return <p>Carregando item vinculado…</p>;
  if (itemQuery.isError) return <p className="u-text-attention">Item vinculado não está mais disponível — considere revisar este vínculo.</p>;
  const item = itemQuery.data.item;
  return (
    <p>
      Item vinculado: <Link to={orgPath(`/items/${itemId}`)}>{item.name}</Link> · vence em {formatAbsoluteDate(item.dueDate)}
    </p>
  );
}

function Timeline({ subjectId, requests, canWrite, showToast }: { subjectId: string; requests: LegacyDocumentRequest[]; canWrite: boolean; showToast: (message: string) => void }) {
  const sorted = [...requests].sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  return (
    <ul>
      {sorted.map((request) => (
        <TimelineEntry key={request.documentRequestId} subjectId={subjectId} request={request} canWrite={canWrite} showToast={showToast} />
      ))}
    </ul>
  );
}

function TimelineEntry({ subjectId, request, canWrite, showToast }: { subjectId: string; request: LegacyDocumentRequest; canWrite: boolean; showToast: (message: string) => void }) {
  const submissionsQuery = useDocumentSubmissions(subjectId, request.assignmentId, true);
  const revokeMutation = useRevokeLegacyDocumentRequest(subjectId, request.assignmentId);
  const [error, setError] = useState<string | undefined>();
  const isActive = request.status === "REQUESTED" || request.status === "OPENED";

  async function handleRevoke() {
    setError(undefined);
    try {
      await revokeMutation.mutateAsync({ documentRequestId: request.documentRequestId, expectedVersion: request.version });
      showToast("Solicitação revogada");
    } catch (err) {
      if (isConflict(err)) {
        setError("Esta solicitação foi alterada por outra pessoa.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não foi possível revogar a solicitação.");
    }
  }

  const ownSubmissions = (submissionsQuery.data?.submissions ?? []).filter((s) => s.documentRequestId === request.documentRequestId);

  return (
    <li>
      <p>
        Solicitação enviada para {request.recipientEmail} · <StatusBadge presentation={presentLegacyDocumentRequestStatus(request.status)} />
      </p>
      {isActive && canWrite ? (
        <Button size="sm" variant="ghost" pending={revokeMutation.isPending} onClick={() => void handleRevoke()}>
          {revokeMutation.isPending ? "Revogando…" : "Revogar"}
        </Button>
      ) : null}
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
      {ownSubmissions.length > 0 ? (
        <ul>
          {ownSubmissions.map((s) => (
            <li key={s.submissionId}>
              Arquivo enviado: {s.fileName} · <StatusBadge presentation={presentSubmissionStatus(s.status)} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
