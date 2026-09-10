/**
 * A06 — Reminder Policy (Block 2, D-258). Per `docs/frontend/prototype-screen-specs/
 * A06-politica-lembrete.md` (audited 2026-09-09): full create/view/edit/disable lifecycle for
 * one item's reminder schedule. Route uses `/items/:itemId/reminder-policy` (this codebase's
 * real path segment, `items` not the spec's `expirations` - same "code over never-implemented
 * spec literal" precedent as A01/D-256) and drops `:policyId` from the URL entirely - the
 * screen resolves the policy via the item's own id (D-258's discovery route), matching how
 * every other per-item screen in this app is addressed.
 *
 * `reminder:manage` is WRITE_ROLES (OWNER/ADMIN/MEMBER) - VIEWER gets a genuinely read-only
 * render (controls hidden, never just disabled, same discipline as A07).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useItem } from "../../hooks/useItem.js";
import { useReminderPolicy } from "../../hooks/useReminderPolicy.js";
import { useSaveReminderPolicy } from "../../hooks/useSaveReminderPolicy.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { formatAbsoluteDate, presentReminderChannelStatus } from "../../api/presentation.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { PageHeader, Section, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { Switch } from "../../components/ui/Switch.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import type { ExpirationItem, MembershipRole, ReminderTrigger } from "../../api/types.js";
import "./ItemReminderPolicy.css";

const WRITE_ROLES: ReadonlySet<MembershipRole> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const DEFAULT_LOCAL_TIME = "09:00";

/** Restricted "[-]P<N>D" grammar (backend `recurrence.ts`'s `parseDayOffset`) - the only shape
 * this screen ever produces or reads, matching the domain's own scope for M3. */
function offsetDays(offsetIso: string): number {
  const match = /^(-)?P(\d+)D$/.exec(offsetIso);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * Number(match[2]);
}

function daysToOffsetIso(days: number): string {
  return days < 0 ? `-P${Math.abs(days)}D` : `P${days}D`;
}

function triggerLabel(trigger: ReminderTrigger, dueDate: string): string {
  const days = offsetDays(trigger.offsetIso);
  const resolvedDate = new Date(dueDate);
  resolvedDate.setUTCDate(resolvedDate.getUTCDate() + days);
  const resolved = formatAbsoluteDate(resolvedDate.toISOString());
  if (days === 0) return `No dia · ${resolved}`;
  if (days < 0) return `${Math.abs(days)} dias antes · ${resolved}`;
  return `${days} dias depois · ${resolved}`;
}

function newTriggerId(): string {
  return crypto.randomUUID();
}

interface EditableState {
  triggers: ReminderTrigger[];
  enabled: boolean;
}

function fromPolicy(triggers: ReminderTrigger[] | undefined, enabled: boolean | undefined): EditableState {
  return { triggers: triggers ?? [], enabled: enabled ?? true };
}

function AddOffsetForm({ existingDays, onAdd }: { existingDays: number[]; onAdd: (days: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("7");
  const [direction, setDirection] = useState<"before" | "same-day">("before");
  const [duplicateError, setDuplicateError] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Adicionar aviso
      </Button>
    );
  }

  function handleAdd() {
    const days = direction === "same-day" ? 0 : -Math.abs(Number(value) || 0);
    if (existingDays.includes(days)) {
      setDuplicateError(true);
      return;
    }
    setDuplicateError(false);
    onAdd(days);
    setOpen(false);
    setValue("7");
    setDirection("before");
  }

  return (
    <div className="ui-form__row" role="group" aria-label="Novo aviso">
      <select value={direction} onChange={(event) => setDirection(event.target.value as "before" | "same-day")} aria-label="Quando avisar">
        <option value="before">Dias antes</option>
        <option value="same-day">No dia</option>
      </select>
      {direction === "before" ? (
        <input
          type="number"
          min={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Número de dias antes"
          className="ui-reminder-policy__offset-input"
        />
      ) : null}
      <Button variant="primary" size="sm" onClick={handleAdd}>
        Adicionar
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
        Cancelar
      </Button>
      {duplicateError ? (
        <span role="alert" className="u-text-secondary">
          Este aviso já existe
        </span>
      ) : null}
    </div>
  );
}

function ReminderPolicyForm({ item, initial, existingPolicyId, expectedVersion }: { item: ExpirationItem; initial: EditableState; existingPolicyId?: string; expectedVersion?: number }) {
  const [state, setState] = useState<EditableState>(initial);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const saveMutation = useSaveReminderPolicy(item.itemId);

  // A remote change (a fresh fetch after OCC conflict, or the initial value first arriving)
  // must never silently clobber an in-progress edit - only re-baseline while NOT dirty.
  useEffect(() => {
    if (!dirty) setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.triggers, initial.enabled]);

  function markDirty(next: EditableState) {
    setState(next);
    setDirty(true);
  }

  function handleAdd(days: number) {
    markDirty({ ...state, triggers: [...state.triggers, { triggerId: newTriggerId(), offsetIso: daysToOffsetIso(days), localTime: DEFAULT_LOCAL_TIME }] });
  }

  function handleRemove(triggerId: string) {
    markDirty({ ...state, triggers: state.triggers.filter((trigger) => trigger.triggerId !== triggerId) });
  }

  function handleToggleEnabled(checked: boolean) {
    markDirty({ ...state, enabled: checked });
  }

  async function handleSave() {
    setConflict(false);
    try {
      await saveMutation.mutateAsync({
        input: {
          scope: "ITEM",
          itemId: item.itemId,
          rule: { name: item.name, triggers: state.triggers, timeZone: DEFAULT_TIME_ZONE, channels: ["EMAIL"] },
          enabled: state.enabled,
        },
        existingPolicyId,
        expectedVersion,
      });
      saveMutation.newIntent();
      setDirty(false);
    } catch (err) {
      if (isConflict(err)) setConflict(true);
    }
  }

  const existingDays = state.triggers.map((trigger) => offsetDays(trigger.offsetIso));
  const schedulerUnavailable = saveMutation.isError && saveMutation.error instanceof ApiError && saveMutation.error.category === "DEPENDENCY_UNAVAILABLE";
  const genericSaveError =
    saveMutation.isError && !conflict && !schedulerUnavailable ? (saveMutation.error instanceof ApiError ? saveMutation.error.message : "Não foi possível salvar. Tente novamente.") : undefined;

  return (
    <div>
      <PageHeader
        above={<Link to={`../${item.itemId}`}>← Voltar para o vencimento</Link>}
        title="Lembretes"
        description={`${item.name} · vence em ${formatAbsoluteDate(item.dueDate)}. Configura quando os avisos são disparados, não como cada pessoa os recebe.`}
        actions={
          <Button variant="primary" onClick={() => void handleSave()} disabled={!dirty} pending={saveMutation.isPending}>
            {saveMutation.isPending ? "Salvando…" : "Salvar lembretes"}
          </Button>
        }
      />

      {conflict ? (
        <InlineNotice tone="critical" announce="alert">
          <p>Esta política foi alterada por outra pessoa. Revise antes de salvar novamente.</p>
        </InlineNotice>
      ) : null}
      {schedulerUnavailable ? (
        <InlineNotice tone="warning" announce="status">
          <p>Não foi possível confirmar o agendamento agora. Suas alterações foram salvas e serão aplicadas assim que o serviço voltar.</p>
        </InlineNotice>
      ) : null}
      {genericSaveError ? (
        <InlineNotice tone="critical" announce="alert">
          <p>{genericSaveError}</p>
        </InlineNotice>
      ) : null}
      {!dirty && saveMutation.isSuccess ? (
        <InlineNotice tone="success" announce="status">
          <p>Lembretes salvos.</p>
        </InlineNotice>
      ) : null}

      <Section heading="Quando avisar" headingId="policy-triggers">
        <Panel padded>
          <Switch label="Política ativa" checked={state.enabled} onChange={handleToggleEnabled} />
          {!state.enabled ? (
            <InlineNotice tone="warning">
              <p>Esta política está desabilitada — nenhum aviso será enviado.</p>
            </InlineNotice>
          ) : null}
          <div className="ui-reminder-policy__triggers" data-disabled={!state.enabled ? "true" : undefined}>
            {state.triggers.length === 0 ? (
              <EmptyState kind="true-empty" message="Nenhum aviso configurado" />
            ) : (
              <ul className="ui-list">
                {state.triggers.map((trigger) => (
                  <li key={trigger.triggerId} className="ui-list-row">
                    <span>{triggerLabel(trigger, item.dueDate)}</span>
                    <Button variant="secondary" size="sm" onClick={() => handleRemove(trigger.triggerId)} aria-label={`Remover aviso de ${triggerLabel(trigger, item.dueDate)}`}>
                      Remover
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <AddOffsetForm existingDays={existingDays} onAdd={handleAdd} />
          </div>
        </Panel>
      </Section>

      <Section heading="Canais" headingId="policy-channels">
        <Panel padded>
          <ul className="ui-list">
            <li className="ui-list-row">
              <span>E-mail</span>
              <StatusBadge presentation={presentReminderChannelStatus("EMAIL")} srPrefix="Canal" />
            </li>
            <li className="ui-list-row">
              <span>WhatsApp</span>
              <StatusBadge presentation={presentReminderChannelStatus("WHATSAPP")} srPrefix="Canal" />
            </li>
          </ul>
        </Panel>
      </Section>

      <InlineNotice tone="info" title="Como os avisos são enviados">
        <p>Os avisos são enviados no fuso horário da organização, fora do período de silêncio configurado em cada usuário.</p>
      </InlineNotice>
    </div>
  );
}

export function ItemReminderPolicy() {
  const { itemId } = useParams<{ itemId: string }>();
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const itemQuery = useItem(itemId ?? "");
  const policyQuery = useReminderPolicy(itemId ?? "");
  const initial = useMemo(() => fromPolicy(policyQuery.data?.policy?.triggers, policyQuery.data?.policy?.enabled), [policyQuery.data]);

  if (!itemId) {
    return <EmptyState kind="unavailable" message="Vencimento não identificado." />;
  }

  if (itemQuery.isPending || policyQuery.isPending) {
    return <InitialLoading label="Carregando lembretes…" />;
  }
  if (itemQuery.isError) {
    if (itemQuery.error instanceof ApiError && itemQuery.error.category === "AUTHORIZATION") {
      return <EmptyState kind="permission-limited" />;
    }
    const message = itemQuery.error instanceof ApiError ? itemQuery.error.message : "Não foi possível carregar este vencimento.";
    return <ErrorState message={message} onRetry={() => void itemQuery.refetch()} />;
  }
  if (policyQuery.isError) {
    const message = policyQuery.error instanceof ApiError ? policyQuery.error.message : "Não foi possível carregar a política de lembretes.";
    return <ErrorState message={message} onRetry={() => void policyQuery.refetch()} />;
  }

  const item = itemQuery.data.item;
  const policy = policyQuery.data.policy;
  const canManage = role !== undefined && WRITE_ROLES.has(role);

  if (!canManage) {
    return (
      <div>
        <PageHeader above={<Link to={orgPath(`/items/${item.itemId}`)}>← Voltar para {item.name}</Link>} title="Lembretes" description={item.name} />
        <Section heading="Quando avisar" headingId="policy-triggers-readonly">
          <Panel padded>
            {policy && policy.triggers.length > 0 ? (
              <ul className="ui-list">
                {policy.triggers.map((trigger) => (
                  <li key={trigger.triggerId} className="ui-list-row">
                    <span>{triggerLabel(trigger, item.dueDate)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState kind="true-empty" message="Nenhum aviso configurado" />
            )}
          </Panel>
        </Section>
      </div>
    );
  }

  return <ReminderPolicyForm item={item} initial={initial} existingPolicyId={policy?.policyId} expectedVersion={policy?.version} />;
}
