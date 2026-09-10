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
import { Link, useLocation, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useItem } from "../../hooks/useItem.js";
import { useDocuments } from "../../hooks/useDocuments.js";
import { presentItemStatus, presentItemUrgency, formatAbsoluteDate, formatRelativeDueDate } from "../../api/presentation.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { ApiError } from "../../api/errors.js";
import type { ExpirationItem } from "../../api/types.js";
import { PageHeader, Panel, Section } from "../../components/ui/Layout.js";
import { ButtonLink } from "../../components/ui/Button.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { UrgencyIndicator } from "../../components/ui/UrgencyIndicator.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import "./ItemDetail.css";

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

/** A05 extension entry points (Block 2, D-2xx): "Lembretes"/A06 is deliberately NOT included
 * here yet — `GET /reminders/policies/{policyId}` requires a policyId the frontend has no way
 * to discover for a given item (policyId is server-generated, unrelated to itemId, and no
 * list/lookup-by-item route exists) - a card here would either always claim "no policy
 * configured" (a decorative lie for items that DO have one) or need a fabricated discovery
 * mechanism. Recorded as a pending backend gap (decisions-log D-2xx), same discipline as A02's
 * D-255 deferrals - never built decorative. */
function documentsEntryNote(query: ReturnType<typeof useDocuments>): string {
  // Codex block-review finding (D-2xx): a persistent load failure must never read identically
  // to "still loading" - both used to collapse into the same neutral prompt.
  if (query.isError) return "Não foi possível carregar a contagem";
  const count = query.data?.documents.filter((document) => document.status !== "DELETED").length;
  if (count === undefined) return "Ver arquivos anexados";
  return count === 0 ? "Nenhum anexo" : `${count} anexo(s)`;
}

function DocumentsEntryCard({ itemId }: { itemId: string }) {
  const orgPath = useOrgPath();
  const query = useDocuments(itemId);
  return (
    <Link className="ui-entry-card" to={orgPath(`/items/${itemId}/documents`)}>
      <strong>Arquivos</strong>
      <span className="u-text-secondary">{documentsEntryNote(query)}</span>
    </Link>
  );
}

function AuditEntryCard() {
  const orgPath = useOrgPath();
  return (
    <Link className="ui-entry-card" to={orgPath("/activity")}>
      <strong>Histórico de auditoria</strong>
      <span className="u-text-secondary">Ver log de atividade</span>
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

  return (
    <div>
      <PageHeader
        above={<Link to={orgPath("/items")}>← Voltar para Vencimentos</Link>}
        title={item.name}
        description={
          // Urgency AND lifecycle status side by side, never merged into one token
          // (mission §32) - "Vence em 3 dias" and "Ativo" are different questions.
          <span className="ui-page-header__badges">
            <UrgencyIndicator urgency={urgency} />
            <StatusBadge presentation={presentItemStatus(item.status)} srPrefix="Situação" />
          </span>
        }
        actions={
          item.status === "ACTIVE" ? (
            <ButtonLink to={orgPath(`/items/${item.itemId}/renew`)} variant="primary">
              Renovar
            </ButtonLink>
          ) : null
        }
      />
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
      <Section heading="Dados do vencimento" headingId="detail-fields">
        <Panel padded>
          <DetailList
            fields={[
              { label: "Categoria", value: item.category },
              { label: "Vencimento", value: formatRelativeDueDate(item.dueDate, now) },
              { label: "Descrição", value: item.description },
              { label: "Emissor", value: item.issuer },
              { label: "Número", value: item.number },
              { label: "Periodicidade", value: item.periodicity },
              { label: "Responsável", value: item.assigneeUserId },
              { label: "Prioridade", value: item.priority },
              { label: "Tags", value: item.tags.length > 0 ? item.tags.join(", ") : undefined },
            ]}
          />
        </Panel>
      </Section>
      <Section heading="Mais sobre este vencimento" headingId="detail-entry-points">
        <div className="ui-entry-card-grid">
          <DocumentsEntryCard itemId={item.itemId} />
          <AuditEntryCard />
        </div>
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
