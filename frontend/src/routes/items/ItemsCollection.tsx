/**
 * Expiration Collection (mission §18-23): "o que precisa da minha atenção?" - a full,
 * filterable, browsable list, distinct from Overview's curated attention summary. The status
 * filter (Ativos/Arquivados/Renovados) drives ONE real backend query each (GET
 * /items/dashboard?status=X queries a single GSI1 partition per status -
 * src/modules/expiration/application/expiration-service.ts's listDashboard - there is no
 * single-call "todos os status" the approved wireframes' flat filter list assumed; see
 * docs/frontend/core-expiration-vertical-slice.md §24, an IMPLEMENTATION FINDING). Within
 * Ativos, items group by urgency (Vencidos/Vence em breve/Demais ativos) using the exact
 * vocabulary and 7-day threshold already validated by the approved Interaction Prototype.
 */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useItemsDashboard } from "../../hooks/useItemsDashboard.js";
import { presentItemUrgency, formatRelativeDueDate, sortByDueDateAscending, type UrgencyPresentation } from "../../api/presentation.js";
import { InitialLoading, ErrorState, EmptyState, BackgroundRefreshIndicator } from "../../components/AsyncStates.js";
import { ApiError } from "../../api/errors.js";
import type { ExpirationItem, ExpirationItemStatus } from "../../api/types.js";

const STATUS_TABS: { value: ExpirationItemStatus; label: string }[] = [
  { value: "ACTIVE", label: "Ativos" },
  { value: "ARCHIVED", label: "Arquivados" },
  { value: "RENEWED", label: "Renovados" },
];

function isKnownStatus(value: string | null): value is ExpirationItemStatus {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "RENEWED";
}

interface RowEntry {
  item: ExpirationItem;
  urgency: UrgencyPresentation;
}

export function ItemsCollection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const status: ExpirationItemStatus = isKnownStatus(statusParam) ? statusParam : "ACTIVE";
  const query = useItemsDashboard(status);
  // Computed once per render, not re-derived per row - a long-lived tab drifting a few
  // minutes stale between renders is an accepted trade-off (Overview.tsx's existing pattern).
  const now = useMemo(() => new Date(), []);

  function selectStatus(next: ExpirationItemStatus) {
    setSearchParams(next === "ACTIVE" ? {} : { status: next });
  }

  if (query.isPending) {
    return <InitialLoading label="Carregando vencimentos…" />;
  }

  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.category === "AUTHORIZATION") {
      return <EmptyState kind="permission-limited" />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar os vencimentos.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const entries: RowEntry[] = sortByDueDateAscending(query.data.items).map((item) => ({ item, urgency: presentItemUrgency(item, now) }));
  const isBackgroundRefreshing = query.isFetching && !query.isPending;

  return (
    <div>
      <h1>Vencimentos</h1>
      <nav aria-label="Filtrar por status">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} type="button" aria-current={tab.value === status ? "page" : undefined} onClick={() => selectStatus(tab.value)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <p>
        <Link to="/items/new">+ Novo vencimento</Link>{" "}
        <button type="button" onClick={() => void query.refetch()}>
          Atualizar
        </button>{" "}
        {isBackgroundRefreshing ? <BackgroundRefreshIndicator /> : null}
      </p>
      {entries.length === 0 ? (
        <EmptyState
          kind={status === "ACTIVE" ? "true-empty" : "filtered-empty"}
          message={status === "ACTIVE" ? "Nenhum vencimento cadastrado ainda." : "Nenhum vencimento neste status."}
        />
      ) : status === "ACTIVE" ? (
        <GroupedActiveList entries={entries} now={now} />
      ) : (
        <FlatList entries={entries} now={now} />
      )}
    </div>
  );
}

function ItemRow({ entry, now }: { entry: RowEntry; now: Date }) {
  const { item, urgency } = entry;
  return (
    <li>
      <span data-tone={urgency.tone}>[{urgency.label}]</span> <Link to={`/items/${item.itemId}`}>{item.name}</Link> <span>{item.category}</span>{" "}
      <span>{formatRelativeDueDate(item.dueDate, now)}</span>
    </li>
  );
}

function GroupedActiveList({ entries, now }: { entries: RowEntry[]; now: Date }) {
  const overdue = entries.filter((entry) => entry.urgency.group === "overdue");
  const soon = entries.filter((entry) => entry.urgency.group === "soon");
  const later = entries.filter((entry) => entry.urgency.group === "later");

  return (
    <>
      {overdue.length > 0 ? (
        <section aria-labelledby="group-overdue">
          <h2 id="group-overdue">Vencidos ({overdue.length})</h2>
          <ul>
            {overdue.map((entry) => (
              <ItemRow key={entry.item.itemId} entry={entry} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
      {soon.length > 0 ? (
        <section aria-labelledby="group-soon">
          <h2 id="group-soon">Vence em breve ({soon.length})</h2>
          <ul>
            {soon.map((entry) => (
              <ItemRow key={entry.item.itemId} entry={entry} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
      {later.length > 0 ? (
        <section aria-labelledby="group-later">
          <h2 id="group-later">Demais ativos ({later.length})</h2>
          <ul>
            {later.map((entry) => (
              <ItemRow key={entry.item.itemId} entry={entry} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function FlatList({ entries, now }: { entries: RowEntry[]; now: Date }) {
  return (
    <ul>
      {entries.map((entry) => (
        <ItemRow key={entry.item.itemId} entry={entry} now={now} />
      ))}
    </ul>
  );
}
