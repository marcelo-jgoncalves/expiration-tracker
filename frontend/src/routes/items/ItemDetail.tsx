/**
 * Expiration Detail (mission §24-25/§91): what is this, when does it expire, what's its
 * status, who's responsible, what actions are available. Deliberately has no Documents
 * section yet - BLOCKER-A's backend routes (GET .../documents, GET .../documents/{id}) were
 * closed 2026-08-25 (NEXT_SESSION_PROMPT.md), so a real contract now exists, but Documents
 * remain explicitly out of scope for this vertical slice (mission §6) - wiring the section
 * itself is separate, not-yet-started frontend work, not a backend blocker anymore.
 *
 * Visual Language milestone: restyled only. Same fields, same order, same lineage rule, same
 * action availability. The record's attributes stay a <dl> - a table would imply comparable
 * rows, and there is exactly one record here.
 */
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Activity, Bell, ClipboardList, Paperclip, Plus, RefreshCw } from "lucide-react";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useItem } from "../../hooks/useItem.js";
import { useDocuments } from "../../hooks/useDocuments.js";
import { useActivity } from "../../hooks/useActivity.js";
import { useMembers } from "../../hooks/useMembers.js";
import { useReminderPolicy } from "../../hooks/useReminderPolicy.js";
import { presentItemStatus, presentItemUrgency, formatAbsoluteDate, resolveAssigneeLabel } from "../../api/presentation.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { ApiError } from "../../api/errors.js";
import type { ExpirationItem } from "../../api/types.js";
import { PageHeader, Panel, Section, SummaryHero } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { UrgencyIndicator } from "../../components/ui/UrgencyIndicator.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { RenewItemDialog } from "./RenewItem.js";
import { ItemDocumentsDialog } from "./ItemDocuments.js";

interface DetailField {
  label: string;
  value: string | undefined;
}

function DetailList({ fields }: { fields: DetailField[] }) {
  const present = fields.filter((field): field is { label: string; value: string } => Boolean(field.value));
  if (present.length === 0) return null;
  return (
    <dl className="ui-detail-list">
      {present.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Best-effort lookup of the source item a renewal came from (mission §38: show renewal
 * lineage only when the backend actually lets us recover it - a single backward hop via
 * `renewedFromId`, never a fabricated full chain the data model doesn't expose). A slow,
 * failed, or permission-denied lookup silently renders nothing rather than blocking or
 * erroring the whole Detail page over an optional embellishment. */
function RenewalLineage({ sourceItemId }: { sourceItemId: string }) {
  const orgPath = useOrgPath();
  const query = useItem(sourceItemId);
  if (!query.data) return null;
  const source = query.data.item;
  return (
    <p className="u-text-secondary">
      Ciclo anterior:{" "}
      <Link to={orgPath(`/items/${source.itemId}`)}>
        {source.name} (venceu em {formatAbsoluteDate(source.dueDate)})
      </Link>
    </p>
  );
}

/** "Lembretes"/A06 entry card (Block 2, D-258) - the item->policy discovery route
 * (`GET /items/{itemId}/reminder-policy`) unblocked this; the card is real, not decorative:
 * it reflects the item's actual policy state (or its absence) via `useReminderPolicy`. */
function reminderPolicyEntryNote(query: ReturnType<typeof useReminderPolicy>): string {
  if (query.isError) return "Não foi possível carregar";
  if (query.data === undefined) return "Ver lembretes";
  if (query.data.policy === null) return "Nenhuma política configurada";
  return query.data.policy.enabled ? "Ativa" : "Desabilitada";
}

function ReminderPolicyEntryCard({ itemId }: { itemId: string }) {
  const orgPath = useOrgPath();
  const query = useReminderPolicy(itemId);
  return (
    <Link className="ui-attention__link" to={orgPath(`/items/${itemId}/reminder-policy`)}>
      <span className="ui-attention__icon ui-attention__icon--accent">
        <Bell size={21} strokeWidth={2} aria-hidden="true" />
      </span>
      <span>
        <span className="ui-attention__count">Lembretes</span>
        <span className="ui-attention__label">{reminderPolicyEntryNote(query)}</span>
      </span>
    </Link>
  );
}

function documentsEntryNote(query: ReturnType<typeof useDocuments>): string {
  // Codex block-review finding (D-2xx): a persistent load failure must never read identically
  // to "still loading" - both used to collapse into the same neutral prompt.
  if (query.isError) return "Não foi possível carregar a contagem";
  const count = query.data?.documents.filter((document) => document.status !== "DELETED").length;
  if (count === undefined) return "Ver arquivos anexados";
  return count === 0 ? "Nenhum anexo" : `${count} anexo(s)`;
}

function DocumentsEntryCard({ itemId, onOpen }: { itemId: string; onOpen: () => void }) {
  const query = useDocuments(itemId);
  return (
    <button type="button" className="ui-attention__link" onClick={onOpen}>
      <span className="ui-attention__icon ui-attention__icon--accent">
        <Paperclip size={21} strokeWidth={2} aria-hidden="true" />
      </span>
      <span>
        <span className="ui-attention__count">Arquivos</span>
        <span className="ui-attention__label">{documentsEntryNote(query)}</span>
      </span>
    </button>
  );
}

/** #16 finding (2026-09-20): GET /activity had no resourceId filter, so this card could only
 * link to the generic log, never show a real per-item count - fixed now that the backend
 * filter exists (resourceId, mirrors resourceType). Counts only the first page (same limit-25
 * cap the backend log view itself has), so "N+" signals more without claiming an exact total. */
function auditEntryNote(query: ReturnType<typeof useActivity>): string {
  if (query.isError) return "Não foi possível carregar o histórico";
  const page = query.data?.pages[0];
  if (!page) return "Ver log de atividade";
  const count = page.entries.length;
  if (count === 0) return "Nenhum evento registrado";
  return `${count}${page.hasMore ? "+" : ""} evento(s)`;
}

function AuditEntryCard({ itemId }: { itemId: string }) {
  const orgPath = useOrgPath();
  const query = useActivity({ resourceId: itemId, enabled: true });
  return (
    <Link className="ui-attention__link" to={orgPath(`/activity?resourceId=${encodeURIComponent(itemId)}`)}>
      <span className="ui-attention__icon ui-attention__icon--accent">
        <Activity size={21} strokeWidth={2} aria-hidden="true" />
      </span>
      <span>
        <span className="ui-attention__count">Histórico de auditoria</span>
        <span className="ui-attention__label">{auditEntryNote(query)}</span>
      </span>
    </Link>
  );
}

function DetailBody({
  item,
  justCreated,
  justRenewed,
  copiedReminderPolicyIds,
}: {
  item: ExpirationItem;
  justCreated: boolean;
  justRenewed: boolean;
  copiedReminderPolicyIds: string[];
}) {
  const orgPath = useOrgPath();
  const now = new Date();
  const urgency = presentItemUrgency(item, now);
  // #15 (2026-09-21): resolves a name/email instead of the raw assigneeUserId - falls back to
  // the id itself while the roster hasn't loaded yet or the id isn't a current member (removed
  // member, stale reference), same "always show something real" rule the rest of this page follows.
  const membersQuery = useMembers();
  const assigneeLabel = resolveAssigneeLabel(item.assigneeUserId, membersQuery.data?.members) ?? item.assigneeUserId;
  const [showRenew, setShowRenew] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);

  return (
    <div>
      <PageHeader
        above={<Link to={orgPath("/items")}>← Voltar para Vencimentos</Link>}
        title={item.name}
        description={
          // Urgency AND lifecycle status side by side, never merged into one token
          // (mission §32) - "Vence em 3 dias" and "Ativo" are different questions. Categoria
          // is a plain label, not a `StatusBadge` (Marcelo, 2026-09-20): it carries no state/
          // tone, so it never borrows the badge's shape-marker convention, which exists
          // specifically to distinguish domain STATES from each other.
          <span className="ui-page-header__badges">
            <UrgencyIndicator urgency={urgency} />
            <StatusBadge presentation={presentItemStatus(item.status)} srPrefix="Situação" />
            <span className="ui-page-header__category">{item.category}</span>
          </span>
        }
        actions={
          item.status === "ACTIVE" ? (
            <Button variant="primary" icon={RefreshCw} onClick={() => setShowRenew(true)}>
              Renovar
            </Button>
          ) : null
        }
      />
      {showRenew ? <RenewItemDialog itemId={item.itemId} onClose={() => setShowRenew(false)} /> : null}
      {showDocuments ? <ItemDocumentsDialog itemId={item.itemId} onClose={() => setShowDocuments(false)} /> : null}
      {justCreated ? (
        <InlineNotice tone="success" announce="status">
          <p>Vencimento criado com sucesso.</p>
        </InlineNotice>
      ) : null}
      {justRenewed ? (
        <InlineNotice tone="success" announce="status">
          <p>Renovação concluída - este é o novo ciclo.</p>
        </InlineNotice>
      ) : null}
      {justRenewed && copiedReminderPolicyIds.length > 0 ? (
        // reminder-delivery-pipeline.md §8 (Marcelo's decision, 2026-08-25): renewal
        // auto-copies the source item's reminder policy - never silent, this notice is the
        // required "review it" prompt, not an optional embellishment. Rendered `warning`,
        // not `success`: it asks the operator to check something, and a green tick would
        // claim the copied schedule is already correct, which nothing has verified.
        <InlineNotice tone="warning" announce="status">
          <p>Os lembretes do ciclo anterior foram copiados para este vencimento. Revise se o prazo de aviso ainda faz sentido.</p>
        </InlineNotice>
      ) : null}
      {item.description ? <p className="u-reading-width u-text-secondary">{item.description}</p> : null}
      {/* Headline restatement of the record's own most-glanced-at fields (Marcelo, 2026-09-20)
          - each one removed from `DetailList` below so nothing repeats: a hero next to a panel
          showing the same value a few lines down would be decoration, not emphasis. */}
      <SummaryHero
        fields={[
          // Sem `helper`: repetiria a data (a mesma data grande, de novo) e a urgência relativa
          // já aparece na pill do cabeçalho (Marcelo, 2026-09-20) - redundância dupla.
          { label: "Vencimento", value: formatAbsoluteDate(item.dueDate) },
          { label: "Periodicidade", value: item.periodicity },
          { label: "Emissor", value: item.issuer },
          { label: "Responsável", value: assigneeLabel },
        ]}
      />
      {/* Unlike the pre-hero version, none of these three is guaranteed present (Categoria/
          Vencimento always were, which is why this gap never showed up before) - an empty
          `DetailList` would still leave the Section+Panel rendering an empty white box
          (real bug caught via screenshot, 2026-09-20). */}
      {item.number || item.priority || item.tags.length > 0 ? (
        <Section heading="Dados do vencimento" headingId="detail-fields" icon={ClipboardList}>
          <Panel padded>
            <DetailList
              fields={[
                { label: "Número", value: item.number },
                { label: "Prioridade", value: item.priority },
                { label: "Tags", value: item.tags.length > 0 ? item.tags.join(", ") : undefined },
              ]}
            />
          </Panel>
        </Section>
      ) : null}
      <Section heading="Mais sobre este vencimento" headingId="detail-entry-points" icon={Plus}>
        {/* Mesmo padrão visual do AttentionRow (Visão Geral, Marcelo 2026-09-20) - badge de
            ícone colorido + texto - com o ajuste necessário: aqui não há contagem, cada card
            mostra um título e um estado dinâmico (real, via hooks), não um número. */}
        <ul className="ui-attention">
          <li className="ui-attention__item">
            <ReminderPolicyEntryCard itemId={item.itemId} />
          </li>
          <li className="ui-attention__item">
            <DocumentsEntryCard itemId={item.itemId} onOpen={() => setShowDocuments(true)} />
          </li>
          <li className="ui-attention__item">
            <AuditEntryCard itemId={item.itemId} />
          </li>
        </ul>
      </Section>
      {item.renewedFromId ? <RenewalLineage sourceItemId={item.renewedFromId} /> : null}
    </div>
  );
}

export function ItemDetail() {
  const { itemId } = useParams<{ itemId: string }>();
  const location = useLocation();
  const orgPath = useOrgPath();
  const query = useItem(itemId ?? "");

  if (!itemId) {
    return <EmptyState kind="unavailable" message="Vencimento não identificado." />;
  }

  if (query.isPending) {
    return <InitialLoading label="Carregando vencimento…" />;
  }

  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.category === "NOT_FOUND") {
      return (
        <EmptyState
          kind="unavailable"
          message="Este vencimento não foi encontrado."
          action={
            <ButtonLink to={orgPath("/items")} variant="secondary">
              Voltar para Vencimentos
            </ButtonLink>
          }
        />
      );
    }
    if (error instanceof ApiError && error.category === "AUTHORIZATION") {
      return <EmptyState kind="permission-limited" />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar este vencimento.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const state = location.state as { justCreated?: boolean; justRenewed?: boolean; copiedReminderPolicyIds?: string[] } | null;
  return (
    <DetailBody
      item={query.data.item}
      justCreated={Boolean(state?.justCreated)}
      justRenewed={Boolean(state?.justRenewed)}
      copiedReminderPolicyIds={state?.copiedReminderPolicyIds ?? []}
    />
  );
}
