/**
 * A16 — Relatórios e exportações (Block 10, D-2xx). `item:export`/`docarchive:requirement-export`
 * (7 downloads) and `reports:subscription-manage` (assinaturas) - all three ADMIN_ROLES
 * exclusively, gated at the screen level (MEMBER/VIEWER see an `EmptyState`, never the catalog
 * with disabled buttons - per the spec's explicit "nunca... catálogo com botões desabilitados").
 *
 * REAL deviations from `A16-relatorios-exportacoes.md`, confirmed directly against
 * `src/modules/reports/{domain,application,http}/*.ts` before writing this screen (see
 * `api/reports.ts`'s own header comment for the full investigation):
 *  1. A subscription covers a SET of report types, never one report per subscription.
 *  2. Cadence is WEEKLY only (dayOfWeek/localTime/timeZone) - no Diária/Mensal.
 *  3. Recipients are existing org members only (`recipientUserIds`) - no ad-hoc e-mails.
 *  4. No update route exists - "Editar" is never offered as a fabricated atomic action; deleting
 *     and recreating is the only real path, presented as two explicit steps.
 *  5. No route lists a subscription's past runs and there is no `lastRunAt` field - the run
 *     history Drawer is not buildable. "Próxima execução" (`nextRunAt`, which IS real) is shown
 *     instead of "Última execução".
 */
import { useState, type FormEvent } from "react";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { useReportSubscriptions } from "../hooks/useReportSubscriptions.js";
import { useCreateReportSubscription } from "../hooks/useCreateReportSubscription.js";
import { useDeleteReportSubscription } from "../hooks/useDeleteReportSubscription.js";
import { useMembers } from "../hooks/useMembers.js";
import { downloadReportCsv } from "../api/reports.js";
import { ApiError, isConflict } from "../api/errors.js";
import type { CreateReportSubscriptionInput, MembershipRole, ReportKey, ReportSubscription, ReportSubscriptionReportType } from "../api/types.js";
import { CollectionSkeleton, EmptyState } from "../components/AsyncStates.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { DataTable, type DataTableColumn } from "../components/ui/DataTable.js";
import { Button } from "../components/ui/Button.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { Dialog } from "../components/ui/Dialog.js";
import { Checkbox } from "../components/ui/Checkbox.js";
import { TextField } from "../components/forms/TextField.js";
import { FormErrorSummary } from "../components/forms/FormErrorSummary.js";
import { useToast } from "../components/Toast.js";
import "./Reports.css";

function canManageReports(role: MembershipRole | undefined): boolean {
  return role === "ADMIN" || role === "OWNER";
}

interface ReportCatalogEntry {
  key: ReportKey;
  reportType: ReportSubscriptionReportType;
  title: string;
  note: string;
  category: "Vencimentos" | "Requisitos";
}

const CATALOG: ReportCatalogEntry[] = [
  { key: "expired-items", reportType: "EXPIRED_ITEMS", title: "Vencimentos expirados", note: "ExpirationItem · status expirado", category: "Vencimentos" },
  { key: "expiring-soon-items", reportType: "EXPIRING_SOON_ITEMS", title: "Vencimentos a vencer", note: "Janela de 7 dias", category: "Vencimentos" },
  { key: "renewed-items", reportType: "RENEWED_ITEMS", title: "Vencimentos renovados", note: "Histórico de renovações", category: "Vencimentos" },
  { key: "expiration-items-by-assignee", reportType: "EXPIRATION_ITEMS_BY_ASSIGNEE", title: "Vencimentos por responsável", note: "Agrupado por assignee", category: "Vencimentos" },
  { key: "missing-requirements", reportType: "MISSING_REQUIREMENTS", title: "Requisitos em falta", note: "Requirement · MISSING", category: "Requisitos" },
  { key: "requirements-by-subject", reportType: "REQUIREMENTS_BY_SUBJECT", title: "Requisitos por fornecedor", note: "Requirement · agrupado por Subject", category: "Requisitos" },
  { key: "requirements-by-assignee", reportType: "REQUIREMENTS_BY_ASSIGNEE", title: "Requisitos por responsável", note: "Requirement · agrupado por assignee", category: "Requisitos" },
];

const REPORT_TITLE_BY_TYPE = new Map(CATALOG.map((entry) => [entry.reportType, entry.title]));

export function Reports() {
  const role = useCurrentMembershipRole();
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ReportSubscription | undefined>();

  const header = <PageHeader title="Relatórios e exportações" description="7 relatórios CSV e assinaturas de envio programado." />;

  if (role !== undefined && !canManageReports(role)) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState kind="permission-limited" message="Relatórios e exportações são administrados por OWNER/ADMIN desta organização." />
        </Panel>
      </>
    );
  }

  // Codex review round (Block 10) finding: while `role` is still resolving, this used to render
  // the full catalog with every "Baixar CSV" button already clickable - a MEMBER/VIEWER on a
  // slow role fetch would briefly see and could click an admin-only control (the backend still
  // refuses it, so never a security bypass, but it violates the spec's own "nunca... catálogo com
  // botões desabilitados" - the catalog must never be ambiguously present before the gate above
  // has a real answer). Default-deny: show a neutral skeleton until role resolves.
  if (role === undefined) {
    return (
      <>
        {header}
        <Panel>
          <CollectionSkeleton label="Carregando…" />
        </Panel>
      </>
    );
  }

  return (
    <>
      {header}
      <Section heading="Vencimentos" headingId="reports-expiration">
        <div className="reports-grid">
          {CATALOG.filter((e) => e.category === "Vencimentos").map((entry) => (
            <ReportCard key={entry.key} entry={entry} />
          ))}
        </div>
      </Section>
      <Section heading="Requisitos" headingId="reports-requirements">
        <div className="reports-grid">
          {CATALOG.filter((e) => e.category === "Requisitos").map((entry) => (
            <ReportCard key={entry.key} entry={entry} />
          ))}
        </div>
      </Section>

      {/* `role` is guaranteed defined and manage-capable here - both other cases already
          returned above. */}
      <SubscriptionsPanel enabled onCreate={() => setCreating(true)} onRemove={setRemoving} />

      {creating ? <SubscriptionDialog onClose={() => setCreating(false)} showToast={showToast} /> : null}
      {removing ? <RemoveSubscriptionDialog subscription={removing} onClose={() => setRemoving(undefined)} showToast={showToast} /> : null}
    </>
  );
}

function ReportCard({ entry }: { entry: ReportCatalogEntry }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "pending" } | { kind: "error"; message: string } | { kind: "truncated" }>({ kind: "idle" });

  async function handleDownload() {
    setState({ kind: "pending" });
    try {
      const result = await downloadReportCsv(entry.key);
      setState(result.truncated ? { kind: "truncated" } : { kind: "idle" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof ApiError ? err.message : "Não foi possível gerar este relatório agora." });
    }
  }

  return (
    <Panel>
      <p className="reports-card__title">{entry.title}</p>
      <p className="reports-card__note">{entry.note}</p>
      <Button variant="secondary" size="sm" pending={state.kind === "pending"} onClick={() => void handleDownload()}>
        Baixar CSV
      </Button>
      {state.kind === "truncated" ? (
        <InlineNotice tone="warning" announce="status">
          Este relatório foi truncado pelo tamanho do arquivo.
        </InlineNotice>
      ) : null}
      {state.kind === "error" ? (
        <InlineNotice tone="critical" announce="alert">
          {state.message}
        </InlineNotice>
      ) : null}
    </Panel>
  );
}

function SubscriptionsPanel({
  enabled,
  onCreate,
  onRemove,
}: {
  enabled: boolean;
  onCreate: () => void;
  onRemove: (subscription: ReportSubscription) => void;
}) {
  const query = useReportSubscriptions(enabled);

  return (
    <Section heading="Assinaturas" headingId="reports-subscriptions" annotation={query.data ? `(${query.data.subscriptions.length})` : undefined}>
      <div className="reports-subscriptions__header">
        <Button variant="secondary" size="sm" onClick={onCreate}>
          Nova assinatura
        </Button>
      </div>
      {query.isPending ? (
        <CollectionSkeleton rows={2} label="Carregando assinaturas…" />
      ) : query.isError ? (
        <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Tentar novamente</Button>}>
          Não foi possível carregar as assinaturas.
        </InlineNotice>
      ) : query.data.subscriptions.length === 0 ? (
        <EmptyState kind="true-empty" message="Nenhuma assinatura configurada. Crie uma assinatura para receber relatórios por e-mail periodicamente." action={<Button variant="primary" onClick={onCreate}>Nova assinatura</Button>} />
      ) : (
        <>
          {/* Codex review round finding: the backend's list route CAN paginate (DynamoDB) but
              accepts no cursor input at all - if it ever does, this is the only honest thing to
              say (never present a truncated count as the real total). */}
          {query.data.lastEvaluatedKey ? (
            <InlineNotice tone="neutral">Há mais assinaturas do que esta lista mostra - a busca por mais páginas ainda não é suportada.</InlineNotice>
          ) : null}
          <SubscriptionsTable subscriptions={query.data.subscriptions} onRemove={onRemove} />
        </>
      )}
    </Section>
  );
}

const DAY_LABELS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function subscriptionReportsLabel(subscription: ReportSubscription): string {
  return subscription.reportTypes.map((t) => REPORT_TITLE_BY_TYPE.get(t) ?? t).join(", ");
}

function SubscriptionsTable({
  subscriptions,
  onRemove,
}: {
  subscriptions: ReportSubscription[];
  onRemove: (subscription: ReportSubscription) => void;
}) {
  const columns: DataTableColumn<ReportSubscription>[] = [
    { key: "reports", header: "Relatórios", primary: true, render: (s) => subscriptionReportsLabel(s) },
    { key: "recipients", header: "Destinatários", render: (s) => `${s.recipientUserIds.length} destinatário(s)` },
    { key: "schedule", header: "Periodicidade", render: (s) => `Semanal · ${DAY_LABELS[s.dayOfWeek]} ${s.localTime} (${s.timeZone})` },
    { key: "nextRunAt", header: "Próxima execução", numeric: true, render: (s) => new Date(s.nextRunAt).toLocaleString("pt-BR") },
    {
      key: "actions",
      header: "Ações",
      actions: true,
      render: (s) => (
        <Button size="sm" variant="danger" onClick={() => onRemove(s)}>
          Remover
        </Button>
      ),
    },
  ];
  return <DataTable caption="Assinaturas de relatório" columns={columns} rows={subscriptions} rowKey={(s) => s.subscriptionId} />;
}

const RECIPIENT_LIMIT = 10;

function SubscriptionDialog({ onClose, showToast }: { onClose: () => void; showToast: (message: string) => void }) {
  const membersQuery = useMembers();
  const mutation = useCreateReportSubscription();
  const [selectedReports, setSelectedReports] = useState<Set<ReportSubscriptionReportType>>(new Set());
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [localTime, setLocalTime] = useState("08:00");
  const [errors, setErrors] = useState<string[]>([]);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function toggleReport(reportType: ReportSubscriptionReportType) {
    setSelectedReports((prev) => {
      const next = new Set(prev);
      if (next.has(reportType)) next.delete(reportType);
      else next.add(reportType);
      return next;
    });
  }

  function toggleRecipient(userId: string) {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else if (next.size < RECIPIENT_LIMIT) next.add(userId);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationErrors: string[] = [];
    if (selectedReports.size === 0) validationErrors.push("Selecione ao menos um relatório.");
    if (selectedRecipients.size === 0) validationErrors.push("Selecione ao menos um destinatário.");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) validationErrors.push("Informe um horário válido (HH:mm).");
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    const input: CreateReportSubscriptionInput = {
      reportTypes: [...selectedReports],
      dayOfWeek,
      localTime,
      timeZone,
      recipientUserIds: [...selectedRecipients],
    };
    try {
      await mutation.mutateAsync(input);
      showToast("Assinatura criada");
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar a assinatura."]);
    }
  }

  return (
    <Dialog title="Nova assinatura" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        <fieldset>
          <legend>Relatórios</legend>
          {CATALOG.map((entry) => (
            <Checkbox key={entry.key} label={entry.title} checked={selectedReports.has(entry.reportType)} onChange={() => toggleReport(entry.reportType)} />
          ))}
        </fieldset>
        <TextField id="subscription-day" label="Dia da semana (1=Segunda..7=Domingo)" value={String(dayOfWeek)} onChange={(v) => setDayOfWeek(Number(v) || 1)} required hint="Cadência semanal - único modo suportado hoje." />
        <TextField id="subscription-time" label="Horário (HH:mm)" value={localTime} onChange={setLocalTime} required />
        <fieldset>
          <legend>Destinatários (membros da organização)</legend>
          {membersQuery.isPending ? (
            <p>Carregando membros…</p>
          ) : membersQuery.isError ? (
            <InlineNotice tone="critical">Não foi possível carregar os membros.</InlineNotice>
          ) : (
            membersQuery.data.members.map((member) => (
              <Checkbox
                key={member.userId}
                label={member.userId}
                checked={selectedRecipients.has(member.userId)}
                onChange={() => toggleRecipient(member.userId)}
                disabled={!selectedRecipients.has(member.userId) && selectedRecipients.size >= RECIPIENT_LIMIT}
              />
            ))
          )}
        </fieldset>
        <InlineNotice tone="neutral">Backend v1 não tem rota de edição - para mudar relatórios/horário/destinatários depois, remova esta assinatura e crie uma nova.</InlineNotice>
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Criando…" : "Salvar"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

function RemoveSubscriptionDialog({ subscription, onClose, showToast }: { subscription: ReportSubscription; onClose: () => void; showToast: (message: string) => void }) {
  const mutation = useDeleteReportSubscription();
  const [error, setError] = useState<string | undefined>();

  async function handleConfirm() {
    setError(undefined);
    try {
      await mutation.mutateAsync({ subscriptionId: subscription.subscriptionId, expectedVersion: subscription.version });
      showToast("Assinatura removida");
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        setError("Esta assinatura foi alterada por outra pessoa. Feche e tente novamente.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a assinatura.");
    }
  }

  return (
    <Dialog title="Remover assinatura" variant="alertdialog" onClose={onClose}>
      <p>
        Remover a assinatura de &quot;{subscriptionReportsLabel(subscription)}&quot; para {subscription.recipientUserIds.length} destinatário(s)? Execuções futuras não serão mais enviadas.
      </p>
      {error ? (
        <InlineNotice tone="critical" announce="alert">
          {error}
        </InlineNotice>
      ) : null}
      {/* Cancel before confirm in DOM order (Dialog.tsx's own contract: initial focus always
          lands on the first focusable element, which must never be the destructive action -
          Codex review round finding, this dialog had the order reversed). */}
      <Button variant="secondary" onClick={onClose}>
        Voltar
      </Button>{" "}
      <Button variant="danger" pending={mutation.isPending} onClick={() => void handleConfirm()}>
        {mutation.isPending ? "Removendo…" : "Confirmar remoção"}
      </Button>
    </Dialog>
  );
}
