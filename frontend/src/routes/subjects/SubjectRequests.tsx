/**
 * A14 — Solicitações e recorrência (Block 6, D-2xx). `docarchive:series-read` (all roles, incl.
 * VIEWER) gates the whole screen (both panels); `docarchive:series-create/-update/-cancel/
 * -materialize` + `docarchive:request-create` (WRITE_ROLES) gate every action — VIEWER sees
 * everything, no write affordance rendered at all (never a disabled button).
 *
 * Two REAL, confirmed deviations from `A14-solicitacoes-recorrencia.md` (the audited spec),
 * investigated directly against the backend before deciding how to adapt, never silently:
 *
 *  1. **Recorrência is a plain day interval, never cron.** `DocumentRequestSeries.cadence` is
 *     `{ intervalDays: number }` (`document-request-series.ts`) — there is no cron parser/field
 *     anywhere in this domain. The spec's "cron: 0 0 1 star-slash-3 star" technical line is never rendered;
 *     "Mensal/Trimestral/Semestral/Anual" map to 30/90/180/365 days, and the advanced mode
 *     reveals a raw "dias" number field instead of a cron expression. "Editar" therefore only
 *     ever changes the RECIPIENT, never the cadence: `updateSeriesCadence` does not exist on the
 *     backend (only `updateSeriesRecipient`, D-230) — the edit dialog shows the current
 *     recorrência read-only with an explicit note, never a fabricated editable control wired to
 *     nothing (same "no fabricated affordance" discipline as A20's field-reorder omission).
 *  2. **"Entrega da credencial" (SENT/SEND_UNCERTAIN/MANUAL) is not shown at all.** That state
 *     lives ONLY in the guest-Lambda's dedicated, pepper-isolated delivery table
 *     (`guest-credential-delivery-worker.test.ts`) — deliberately walled off from the
 *     tenant-facing Lambda (D-146's security boundary). No route/method exists anywhere for the
 *     tenant side to read it. The "Link do convidado" column instead derives its text purely
 *     from `DocumentRequest.status`/`deadline` (`presentGuestLinkState`, `api/presentation.ts`) —
 *     real data the tenant side genuinely has, never a fabricated delivery-confirmation claim.
 *     Both gaps are named in `docs/architecture/decisions-log.md`/`NEXT_SESSION_PROMPT.md` as
 *     real, pre-existing backend limitations, not something this screen invents or hides.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useActiveOrganization } from "../../auth/ActiveOrganizationContext.js";
import { queryKeys } from "../../api/queryKeys.js";
import { useSubject } from "../../hooks/useSubject.js";
import { useRequirementsForSubject } from "../../hooks/useRequirementsForSubject.js";
import { useDocumentRequestSeries } from "../../hooks/useDocumentRequestSeries.js";
import { useDocumentRequestsForSubject } from "../../hooks/useDocumentRequestsForSubject.js";
import { useCreateDocumentRequest } from "../../hooks/useCreateDocumentRequest.js";
import { useCreateSeries } from "../../hooks/useCreateSeries.js";
import { useCancelSeries } from "../../hooks/useCancelSeries.js";
import { useMaterializeSeriesAttempt } from "../../hooks/useMaterializeSeriesAttempt.js";
import { useUpdateSeriesRecipient } from "../../hooks/useUpdateSeriesRecipient.js";
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
import { SelectField } from "../../components/forms/SelectField.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentDocumentRequestSeriesStatus, presentGuestLinkState, formatAbsoluteDate } from "../../api/presentation.js";
import type { DocumentRequest, DocumentRequestSeries, MembershipRole, Requirement } from "../../api/types.js";
import "./SubjectRequests.css";

const WRITE_ROLES: ReadonlySet<MembershipRole> = new Set(["OWNER", "ADMIN", "MEMBER"]);

const NAMED_CADENCES: { value: string; label: string; intervalDays: number }[] = [
  { value: "MONTHLY", label: "Mensal", intervalDays: 30 },
  { value: "QUARTERLY", label: "Trimestral", intervalDays: 90 },
  { value: "SEMIANNUAL", label: "Semestral", intervalDays: 180 },
  { value: "ANNUAL", label: "Anual", intervalDays: 365 },
];

function cadenceLabel(intervalDays: number): string {
  const named = NAMED_CADENCES.find((c) => c.intervalDays === intervalDays);
  return named ? named.label : `A cada ${intervalDays} dias`;
}

function isPendingAvulso(request: DocumentRequest): boolean {
  return !request.seriesId && (request.status === "REQUESTED" || request.status === "OPENED");
}

export function SubjectRequests() {
  const { subjectId = "", seriesId: seriesIdParam } = useParams<{ subjectId: string; seriesId?: string }>();
  const orgPath = useOrgPath();
  const navigate = useNavigate();
  const role = useCurrentMembershipRole();
  const canWrite = role !== undefined && WRITE_ROLES.has(role);
  const { showToast } = useToast();

  const subjectQuery = useSubject(subjectId);
  const requirementsQuery = useRequirementsForSubject(subjectId);
  const seriesQuery = useDocumentRequestSeries(subjectId);
  const requestsQuery = useDocumentRequestsForSubject(subjectId);

  const [showAvulsoDialog, setShowAvulsoDialog] = useState(false);
  const [seriesDialog, setSeriesDialog] = useState<{ mode: "create" } | { mode: "edit"; series: DocumentRequestSeries } | undefined>();
  const [cancelingSeries, setCancelingSeries] = useState<DocumentRequestSeries | undefined>();
  const [viewingRequest, setViewingRequest] = useState<DocumentRequest | undefined>();

  if (subjectQuery.isPending) return <InitialLoading label="Carregando fornecedor…" />;
  if (subjectQuery.isError) {
    const message = subjectQuery.error instanceof ApiError ? subjectQuery.error.message : "Não foi possível carregar este fornecedor.";
    return <ErrorState message={message} onRetry={() => void subjectQuery.refetch()} />;
  }
  const subject = subjectQuery.data.subject;

  const requirements = requirementsQuery.data?.requirements ?? [];
  const series = seriesQuery.data?.series ?? [];
  const requests = requestsQuery.data?.documentRequests ?? [];

  const requirementsWithoutPendingAvulso = requirements.filter((r) => !requests.some((req) => req.requirementId === r.requirementId && isPendingAvulso(req)));
  const requirementsWithoutActiveSeries = requirements.filter((r) => !series.some((s) => s.requirementId === r.requirementId && s.status === "ACTIVE"));

  const activeSeriesFromParam = seriesIdParam ? series.find((s) => s.seriesId === seriesIdParam) : undefined;

  function requirementName(requirementId: string): string {
    return requirements.find((r) => r.requirementId === requirementId)?.name ?? requirementId;
  }

  return (
    <div>
      <PageHeader
        above={<Link to={orgPath(`/subjects/${subjectId}`)}>← Voltar para {subject.displayName}</Link>}
        title="Solicitações e recorrência"
        description={`${subject.displayName} · geração de solicitações de documento a partir de Requisitos.`}
        actions={
          canWrite ? (
            <>
              <Button variant="secondary" onClick={() => setShowAvulsoDialog(true)}>
                Nova solicitação avulsa
              </Button>{" "}
              <Button variant="primary" onClick={() => setSeriesDialog({ mode: "create" })}>
                Nova série recorrente
              </Button>
            </>
          ) : undefined
        }
      />

      <Section heading="Séries recorrentes" headingId="series-heading" annotation={`(${series.length})`}>
        {seriesQuery.isPending ? (
          <CollectionSkeleton rows={3} label="Carregando séries…" />
        ) : seriesQuery.isError ? (
          <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void seriesQuery.refetch()}>Tentar novamente</Button>}>
            Não foi possível carregar as séries recorrentes.
          </InlineNotice>
        ) : series.length === 0 ? (
          <EmptyState
            kind="true-empty"
            message="Nenhuma série recorrente configurada. Crie uma série para receber este documento periodicamente sem ação manual."
            action={canWrite ? <Button variant="primary" onClick={() => setSeriesDialog({ mode: "create" })}>Nova série recorrente</Button> : undefined}
          />
        ) : (
          <Panel>
            <SeriesTable
              series={series}
              requirementName={requirementName}
              canWrite={canWrite}
              orgPath={orgPath}
              subjectId={subjectId}
              onEdit={(s) => setSeriesDialog({ mode: "edit", series: s })}
              onCancel={(s) => setCancelingSeries(s)}
              showToast={showToast}
            />
          </Panel>
        )}
      </Section>

      <Section heading="Solicitações avulsas e materializações" headingId="requests-heading" annotation={`(${requests.length})`}>
        {requestsQuery.isPending ? (
          <CollectionSkeleton rows={3} label="Carregando solicitações…" />
        ) : requestsQuery.isError ? (
          <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void requestsQuery.refetch()}>Tentar novamente</Button>}>
            Não foi possível carregar as solicitações.
          </InlineNotice>
        ) : requests.length === 0 ? (
          <EmptyState
            kind="true-empty"
            message="Nenhuma solicitação avulsa registrada. Crie uma solicitação avulsa para pedir este documento uma única vez."
            action={canWrite ? <Button variant="secondary" onClick={() => setShowAvulsoDialog(true)}>Nova solicitação avulsa</Button> : undefined}
          />
        ) : (
          <Panel>
            <RequestsTable requests={requests} requirementName={requirementName} onView={(r) => setViewingRequest(r)} />
          </Panel>
        )}
      </Section>

      {showAvulsoDialog ? (
        <CreateAvulsoDialog subjectId={subjectId} requirements={requirementsWithoutPendingAvulso} onClose={() => setShowAvulsoDialog(false)} showToast={showToast} />
      ) : null}

      {seriesDialog ? (
        <SeriesDialog
          subjectId={subjectId}
          mode={seriesDialog}
          requirements={requirementsWithoutActiveSeries}
          onClose={() => setSeriesDialog(undefined)}
          showToast={showToast}
        />
      ) : null}

      {cancelingSeries ? (
        <CancelSeriesDialog subjectId={subjectId} series={cancelingSeries} requirementName={requirementName} onClose={() => setCancelingSeries(undefined)} showToast={showToast} />
      ) : null}

      {viewingRequest ? <RequestDetailDialog request={viewingRequest} requirementName={requirementName} onClose={() => setViewingRequest(undefined)} /> : null}

      {activeSeriesFromParam ? (
        <SeriesDetailDialog
          series={activeSeriesFromParam}
          requests={requests}
          requirementName={requirementName}
          canWrite={canWrite}
          subjectId={subjectId}
          onClose={() => navigate(orgPath(`/subjects/${subjectId}/requests`))}
          onEdit={() => {
            navigate(orgPath(`/subjects/${subjectId}/requests`));
            setSeriesDialog({ mode: "edit", series: activeSeriesFromParam });
          }}
          onCancel={() => {
            navigate(orgPath(`/subjects/${subjectId}/requests`));
            setCancelingSeries(activeSeriesFromParam);
          }}
          showToast={showToast}
        />
      ) : null}
    </div>
  );
}

function SeriesTable({
  series,
  requirementName,
  canWrite,
  orgPath,
  subjectId,
  onEdit,
  onCancel,
  showToast,
}: {
  series: DocumentRequestSeries[];
  requirementName: (id: string) => string;
  canWrite: boolean;
  orgPath: (path: string) => string;
  subjectId: string;
  onEdit: (series: DocumentRequestSeries) => void;
  onCancel: (series: DocumentRequestSeries) => void;
  showToast: (message: string) => void;
}) {
  const columns: DataTableColumn<DocumentRequestSeries>[] = [
    {
      key: "requirement",
      header: "Requisito",
      primary: true,
      // Design deviation, named: the spec's "clique na linha abre o detalhe" assumes whole-row
      // activation, which `DataTable` (`components/ui/DataTable.tsx`) does not support today (no
      // per-row click/keyboard-activation prop exists) - extending it is out of this block's
      // scope (implementation-sequencing-plan.md §2: extend the design system only when a
      // journey demonstrates the need, never speculatively). The primary cell's own link is the
      // reachable equivalent - same destination (`/series/:seriesId`), same detail dialog.
      render: (s) => <Link to={orgPath(`/subjects/${subjectId}/series/${s.seriesId}`)}>{requirementName(s.requirementId)}</Link>,
    },
    { key: "status", header: "Status", render: (s) => <StatusBadge presentation={presentDocumentRequestSeriesStatus(s.status)} /> },
    {
      key: "cadence",
      header: "Recorrência",
      render: (s) => (s.status === "ACTIVE" ? cadenceLabel(s.cadence.intervalDays) : "—"),
    },
    { key: "nextDueAt", header: "Próxima geração", numeric: true, render: (s) => (s.status === "ACTIVE" ? formatAbsoluteDate(s.nextDueAt) : "—") },
    { key: "recipient", header: "Destinatário", render: (s) => (s.recipientEmail ? s.recipientEmail : <span className="u-text-attention">Não definido</span>) },
    {
      key: "actions",
      header: "Ações",
      actions: true,
      render: (s) =>
        !canWrite ? null : s.status === "CANCELLED" ? (
          <CellSecondary>Cancelada</CellSecondary>
        ) : (
          <SeriesRowActions subjectId={subjectId} series={s} onEdit={() => onEdit(s)} onCancel={() => onCancel(s)} showToast={showToast} />
        ),
    },
  ];

  return (
    <DataTable
      caption="Séries recorrentes"
      columns={columns}
      rows={series}
      rowKey={(s) => s.seriesId}
    />
  );
}

function SeriesRowActions({
  subjectId,
  series,
  onEdit,
  onCancel,
  showToast,
}: {
  subjectId: string;
  series: DocumentRequestSeries;
  onEdit: () => void;
  onCancel: () => void;
  showToast: (message: string) => void;
}) {
  const materialize = useMaterializeSeriesAttempt(subjectId, series.seriesId);
  const [error, setError] = useState<string | undefined>();
  const hasRecipient = Boolean(series.recipientEmail);

  async function handleMaterialize() {
    setError(undefined);
    try {
      await materialize.mutateAsync({ expectedVersion: series.version });
      showToast("Solicitação gerada");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível gerar a solicitação.");
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" pending={materialize.isPending} disabled={!hasRecipient} title={!hasRecipient ? "Defina um destinatário para gerar solicitações desta série" : undefined} onClick={() => void handleMaterialize()}>
        {materialize.isPending ? "Gerando…" : "Gerar agora"}
      </Button>{" "}
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Editar
      </Button>{" "}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
    </>
  );
}

function RequestsTable({ requests, requirementName, onView }: { requests: DocumentRequest[]; requirementName: (id: string) => string; onView: (request: DocumentRequest) => void }) {
  const now = new Date();
  const columns: DataTableColumn<DocumentRequest>[] = [
    { key: "requirement", header: "Requisito", primary: true, render: (r) => requirementName(r.requirementId) },
    { key: "createdAt", header: "Gerada em", numeric: true, render: (r) => formatAbsoluteDate(r.createdAt) },
    { key: "link", header: "Link do convidado", render: (r) => presentGuestLinkState(r, now) },
    {
      key: "actions",
      header: "Ações",
      actions: true,
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => onView(r)}>
          Ver
        </Button>
      ),
    },
  ];

  return <DataTable caption="Solicitações avulsas e materializações" columns={columns} rows={requests} rowKey={(r) => r.documentRequestId} />;
}

function CreateAvulsoDialog({ subjectId, requirements, onClose, showToast }: { subjectId: string; requirements: Requirement[]; onClose: () => void; showToast: (message: string) => void }) {
  const mutation = useCreateDocumentRequest(subjectId);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requirement) {
      setErrors(["Selecione um Requisito."]);
      return;
    }
    if (!email.trim()) {
      setErrors(["Informe o e-mail do destinatário."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ subjectId, requirementId: requirement.requirementId, recipientEmail: email.trim() });
      showToast("Solicitação criada");
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar a solicitação."]);
    }
  }

  return (
    <Dialog title="Nova solicitação avulsa" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        <Combobox label="Requisito" required options={requirements} value={requirement} onChange={setRequirement} getOptionId={(r) => r.requirementId} getOptionLabel={(r) => r.name} />
        <TextField id="avulso-email" label="Destinatário" type="text" value={email} onChange={setEmail} required hint="E-mail que receberá o link de convidado." />
        <InlineNotice tone="neutral">
          Um link de convidado sem login será gerado e enviado a este e-mail. O envio é confirmado apenas como aceito pelo provedor — não como recebido.
        </InlineNotice>
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Criando…" : "Criar solicitação"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

function SeriesDialog({
  subjectId,
  mode,
  requirements,
  onClose,
  showToast,
}: {
  subjectId: string;
  mode: { mode: "create" } | { mode: "edit"; series: DocumentRequestSeries };
  requirements: Requirement[];
  onClose: () => void;
  showToast: (message: string) => void;
}) {
  const isEdit = mode.mode === "edit";
  const editingSeries = isEdit ? mode.series : undefined;
  const createMutation = useCreateSeries(subjectId);
  const recipientMutation = useUpdateSeriesRecipient(subjectId, editingSeries?.seriesId ?? "");
  const queryClient = useQueryClient();
  const { organizationId } = useActiveOrganization();
  const [requirement, setRequirement] = useState<Requirement | null>(requirements[0] ?? null);
  const [email, setEmail] = useState(editingSeries?.recipientEmail ?? "");
  const [cadenceOption, setCadenceOption] = useState(NAMED_CADENCES[0]?.value ?? "MONTHLY");
  const [advancedDays, setAdvancedDays] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);

  const intervalDays = advanced ? Number(advancedDays) || 0 : (NAMED_CADENCES.find((c) => c.value === cadenceOption)?.intervalDays ?? 0);
  const previewDate = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors([]);
    setConflict(false);

    if (isEdit && editingSeries) {
      try {
        await recipientMutation.mutateAsync({ recipientEmail: email.trim() || null, expectedVersion: editingSeries.version });
        showToast("Série atualizada");
        onClose();
      } catch (err) {
        if (isConflict(err)) {
          setConflict(true);
          // The dialog's own `editingSeries` is a snapshot passed in at open time, never a live
          // subscription - it cannot repopulate itself in place. Invalidating here at least makes
          // sure the LIST behind this dialog shows the current version the moment the user closes
          // and reopens it (the copy below tells them to do exactly that, honestly, rather than
          // implying an in-place refresh that never happens).
          if (organizationId) void queryClient.invalidateQueries({ queryKey: queryKeys.documentArchive.series(organizationId, subjectId) });
          return;
        }
        setErrors([err instanceof ApiError ? err.message : "Não foi possível atualizar a série."]);
      }
      return;
    }

    if (!requirement) {
      setErrors(["Selecione um Requisito."]);
      return;
    }
    if (!email.trim()) {
      setErrors(["Informe o e-mail do destinatário."]);
      return;
    }
    if (intervalDays <= 0) {
      setErrors(["Informe uma recorrência válida."]);
      return;
    }
    try {
      await createMutation.mutateAsync({ subjectId, requirementId: requirement.requirementId, cadence: { intervalDays }, recipientEmail: email.trim() });
      showToast("Série criada");
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar a série."]);
    }
  }

  const pending = createMutation.isPending || recipientMutation.isPending;

  return (
    <Dialog title={isEdit ? "Editar série" : "Nova série recorrente"} onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        {conflict ? (
          <InlineNotice tone="warning" announce="alert">
            Esta série foi alterada por outra pessoa. Feche este formulário e abra "Editar" novamente para ver os valores atuais antes de salvar.
          </InlineNotice>
        ) : null}
        {isEdit && editingSeries ? (
          <p>
            <strong>Requisito:</strong> {editingSeries.requirementId}
          </p>
        ) : (
          <Combobox label="Requisito" required options={requirements} value={requirement} onChange={setRequirement} getOptionId={(r) => r.requirementId} getOptionLabel={(r) => r.name} />
        )}
        <TextField id="series-email" label="Destinatário" value={email} onChange={setEmail} required={!isEdit} hint="E-mail que receberá o link de convidado a cada ciclo." />
        {isEdit ? (
          <InlineNotice tone="neutral">
            A recorrência desta série ({editingSeries ? cadenceLabel(editingSeries.cadence.intervalDays) : ""}) não pode ser alterada aqui — apenas o destinatário. Alterar a
            recorrência de uma série existente ainda não é uma capacidade do sistema.
          </InlineNotice>
        ) : (
          <>
            {!advanced ? (
              <SelectField id="series-cadence" label="Recorrência" value={cadenceOption} onChange={setCadenceOption} required options={NAMED_CADENCES.map((c) => ({ value: c.value, label: c.label }))} />
            ) : (
              <TextField id="series-cadence-days" label="Recorrência (dias)" value={advancedDays} onChange={setAdvancedDays} required hint="Número de dias entre cada geração." />
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? "Usar opção nomeada" : "Modo avançado"}
            </Button>
            {intervalDays > 0 ? <p>Próxima geração estimada: {formatAbsoluteDate(previewDate.toISOString())}</p> : null}
          </>
        )}
        <Button type="submit" variant="primary" pending={pending}>
          {pending ? "Salvando…" : isEdit ? "Salvar" : "Criar série"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

function CancelSeriesDialog({
  subjectId,
  series,
  requirementName,
  onClose,
  showToast,
}: {
  subjectId: string;
  series: DocumentRequestSeries;
  requirementName: (id: string) => string;
  onClose: () => void;
  showToast: (message: string) => void;
}) {
  const mutation = useCancelSeries(subjectId, series.seriesId);
  const [error, setError] = useState<string | undefined>();

  async function handleConfirm() {
    setError(undefined);
    try {
      await mutation.mutateAsync({ expectedVersion: series.version });
      showToast("Série cancelada");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível cancelar a série.");
    }
  }

  return (
    <Dialog title="Cancelar série" variant="alertdialog" onClose={onClose}>
      <p>
        Cancelar série &quot;{requirementName(series.requirementId)}&quot;? Solicitações futuras não serão mais geradas automaticamente. O histórico permanece visível.
      </p>
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
      <Button variant="ghost" pending={mutation.isPending} onClick={() => void handleConfirm()}>
        {mutation.isPending ? "Cancelando…" : "Confirmar cancelamento"}
      </Button>{" "}
      <Button variant="secondary" onClick={onClose}>
        Voltar
      </Button>
    </Dialog>
  );
}

function RequestDetailDialog({ request, requirementName, onClose }: { request: DocumentRequest; requirementName: (id: string) => string; onClose: () => void }) {
  const now = new Date();
  return (
    <Dialog title="Detalhe da solicitação" onClose={onClose}>
      <p>
        <strong>Requisito:</strong> {requirementName(request.requirementId)}
      </p>
      <p>
        <strong>Gerada em:</strong> {formatAbsoluteDate(request.createdAt)}
      </p>
      <p>
        <strong>Link do convidado:</strong> {presentGuestLinkState(request, now)}
      </p>
      <Button variant="secondary" onClick={onClose}>
        Fechar
      </Button>
    </Dialog>
  );
}

function SeriesDetailDialog({
  series,
  requests,
  requirementName,
  canWrite,
  subjectId,
  onClose,
  onEdit,
  onCancel,
  showToast,
}: {
  series: DocumentRequestSeries;
  requests: DocumentRequest[];
  requirementName: (id: string) => string;
  canWrite: boolean;
  subjectId: string;
  onClose: () => void;
  onEdit: () => void;
  onCancel: () => void;
  showToast: (message: string) => void;
}) {
  const materialize = useMaterializeSeriesAttempt(subjectId, series.seriesId);
  const [error, setError] = useState<string | undefined>();
  const cycleRequests = requests.filter((r) => r.seriesId === series.seriesId);

  async function handleMaterialize() {
    setError(undefined);
    try {
      await materialize.mutateAsync({ expectedVersion: series.version });
      showToast("Solicitação gerada");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível gerar a solicitação.");
    }
  }

  return (
    <Dialog title={requirementName(series.requirementId)} onClose={onClose}>
      <p>
        <strong>Status:</strong> <StatusBadge presentation={presentDocumentRequestSeriesStatus(series.status)} />
      </p>
      {series.status === "ACTIVE" ? (
        <>
          <p>
            <strong>Recorrência:</strong> {cadenceLabel(series.cadence.intervalDays)}
          </p>
          <p>
            <strong>Próxima geração:</strong> {formatAbsoluteDate(series.nextDueAt)}
          </p>
        </>
      ) : null}
      <p>
        <strong>Destinatário:</strong> {series.recipientEmail ?? "Não definido"}
      </p>
      {cycleRequests.length === 0 ? (
        <p>Aguardando a primeira geração em {formatAbsoluteDate(series.nextDueAt)}.</p>
      ) : (
        <p>{cycleRequests.length} solicitação(ões) já geradas por esta série.</p>
      )}
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
      {canWrite && series.status === "ACTIVE" ? (
        <>
          <Button variant="primary" pending={materialize.isPending} disabled={!series.recipientEmail} onClick={() => void handleMaterialize()}>
            {materialize.isPending ? "Gerando…" : "Gerar agora"}
          </Button>{" "}
          <Button variant="secondary" onClick={onEdit}>
            Editar
          </Button>{" "}
          <Button variant="ghost" onClick={onCancel}>
            Cancelar série
          </Button>{" "}
        </>
      ) : null}
      <Button variant="secondary" onClick={onClose}>
        Fechar
      </Button>
    </Dialog>
  );
}
