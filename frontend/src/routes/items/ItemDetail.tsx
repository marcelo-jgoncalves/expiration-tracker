/**
 * Expiration Detail (mission §24-25/§91): what is this, when does it expire, what's its
 * status, who's responsible, what actions are available. Deliberately has no Documents
 * section at all - BLOCKER-A (no route reads/lists Document/DocumentSubmission) means there is
 * no real contract to back one, and Documents are explicitly out of scope for this vertical
 * slice (mission §6) - omitting the section entirely is the honest choice, never a fabricated
 * "nenhum documento" claim the backend has no way to actually know (mission §25).
 */
import { Link, useLocation, useParams } from "react-router-dom";
import { useItem } from "../../hooks/useItem.js";
import { presentItemUrgency, formatAbsoluteDate, formatRelativeDueDate } from "../../api/presentation.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { ApiError } from "../../api/errors.js";
import type { ExpirationItem } from "../../api/types.js";

interface DetailField {
  label: string;
  value: string | undefined;
}

function DetailList({ fields }: { fields: DetailField[] }) {
  const present = fields.filter((field): field is { label: string; value: string } => Boolean(field.value));
  if (present.length === 0) return null;
  return (
    <dl>
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
  const query = useItem(sourceItemId);
  if (!query.data) return null;
  const source = query.data.item;
  return (
    <p>
      Ciclo anterior:{" "}
      <Link to={`/items/${source.itemId}`}>
        {source.name} (venceu em {formatAbsoluteDate(source.dueDate)})
      </Link>
    </p>
  );
}

function DetailBody({ item, justCreated, justRenewed }: { item: ExpirationItem; justCreated: boolean; justRenewed: boolean }) {
  const now = new Date();
  const urgency = presentItemUrgency(item, now);

  return (
    <div>
      <p>
        <Link to="/items">← Voltar para Vencimentos</Link>
      </p>
      {justCreated ? <p role="status">Vencimento criado com sucesso.</p> : null}
      {justRenewed ? <p role="status">Renovação concluída - este é o novo ciclo.</p> : null}
      <h1>{item.name}</h1>
      <p>
        <span data-tone={urgency.tone}>[{urgency.label}]</span>
      </p>
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
      {item.renewedFromId ? <RenewalLineage sourceItemId={item.renewedFromId} /> : null}
      {item.status === "ACTIVE" ? (
        <p>
          <Link to={`/items/${item.itemId}/renew`}>Renovar</Link>
        </p>
      ) : null}
    </div>
  );
}

export function ItemDetail() {
  const { itemId } = useParams<{ itemId: string }>();
  const location = useLocation();
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
      return <EmptyState kind="unavailable" message="Este vencimento não foi encontrado." action={<Link to="/items">Voltar para Vencimentos</Link>} />;
    }
    if (error instanceof ApiError && error.category === "AUTHORIZATION") {
      return <EmptyState kind="permission-limited" />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar este vencimento.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const state = location.state as { justCreated?: boolean; justRenewed?: boolean } | null;
  return <DetailBody item={query.data.item} justCreated={Boolean(state?.justCreated)} justRenewed={Boolean(state?.justRenewed)} />;
}
