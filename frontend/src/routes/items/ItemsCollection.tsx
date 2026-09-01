/**
 * Expiration Collection (Core Expiration Vertical Slice §18-23): a full, filterable,
 * browsable list, distinct from Overview's curated attention summary. The status filter
 * (Ativos/Arquivados/Renovados) drives ONE real backend query each (GET
 * /items/dashboard?status=X queries a single GSI1 partition per status -
 * src/modules/expiration/application/expiration-service.ts's listDashboard - there is no
 * single-call "todos os status" the approved wireframes' flat filter list assumed; see
 * docs/frontend/core-expiration-vertical-slice.md §24, an IMPLEMENTATION FINDING). Within
 * Ativos, items group by urgency (Vencidos/Vence em breve/Demais ativos) using the exact
 * vocabulary and 7-day threshold already validated by the approved Interaction Prototype.
 *
 * Visual Language milestone — the one structural change, and why it is not a UX redesign:
 * the collection was an `<ul>/<li>` of records that share attributes. That is the wrong
 * primitive for finding/comparing/scanning at volume (mission §24-§26, NN/g on data tables),
 * and the density stress scenario is precisely where it fails. It is now a real semantic
 * `<table>` with the SAME data, SAME ordering, SAME grouping, SAME filter behaviour and SAME
 * route contract. Urgency and lifecycle status are separate columns (mission §32) rather
 * than one bracketed token doing both jobs.
 */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useItemsDashboardPage } from "../../hooks/useItemsDashboard.js";
import {
  presentItemStatus,
  presentItemUrgency,
  formatAbsoluteDate,
  formatRelativeDueContext,
  sortByDueDateAscending,
  type UrgencyPresentation,
} from "../../api/presentation.js";
import { CollectionSkeleton, ErrorState, EmptyState, BackgroundRefreshIndicator } from "../../components/AsyncStates.js";
import { ApiError } from "../../api/errors.js";
import type { ExpirationItem, ExpirationItemStatus } from "../../api/types.js";
import { PageHeader, Panel, Toolbar, ToolbarSpacer } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { DataTable, CellSecondary, type DataTableColumn, type DataTableGroup } from "../../components/ui/DataTable.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { UrgencyIndicator } from "../../components/ui/UrgencyIndicator.js";

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

function buildColumns(now: Date): DataTableColumn<RowEntry>[] {
  return [
    {
      key: "name",
      header: "Vencimento",
      primary: true,
      render: ({ item }) => (
        <>
          <Link to={`/items/${item.itemId}`}>{item.name}</Link>
          {item.issuer || item.number ? <CellSecondary>{[item.issuer, item.number ? `nº ${item.number}` : undefined].filter(Boolean).join(" · ")}</CellSecondary> : null}
        </>
      ),
    },
    {
      key: "category",
      header: "Categoria",
      render: ({ item }) => <span className="u-text-secondary">{item.category}</span>,
    },
    {
      key: "dueDate",
      header: "Data de vencimento",
      numeric: true,
      // Absolute date on the first line, relative context underneath (mission §19) - never
      // "em breve" alone for a critical date.
      render: ({ item }) => (
        <>
          {formatAbsoluteDate(item.dueDate)}
          <CellSecondary>{formatRelativeDueContext(item.dueDate, now)}</CellSecondary>
        </>
      ),
    },
    {
      key: "urgency",
      header: "Urgência",
      render: ({ urgency }) => <UrgencyIndicator urgency={urgency} />,
    },
    {
      key: "status",
      header: "Situação",
      render: ({ item }) => <StatusBadge presentation={presentItemStatus(item.status)} srPrefix="Situação" />,
    },
    {
      key: "actions",
      header: "Ações",
      actions: true,
      render: ({ item }) =>
        item.status === "ACTIVE" ? (
          <ButtonLink to={`/items/${item.itemId}/renew`} variant="tertiary" size="sm">
            Renovar
          </ButtonLink>
        ) : null,
    },
  ];
}

export function ItemsCollection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const status: ExpirationItemStatus = isKnownStatus(statusParam) ? statusParam : "ACTIVE";
  const query = useItemsDashboardPage(status);
  // Computed once per render, not re-derived per row - a long-lived tab drifting a few
  // minutes stale between renders is an accepted trade-off (Overview.tsx's existing pattern).
  const now = useMemo(() => new Date(), []);
  const columns = useMemo(() => buildColumns(now), [now]);

  function selectStatus(next: ExpirationItemStatus) {
    setSearchParams(next === "ACTIVE" ? {} : { status: next });
  }

  const header = (
    <PageHeader
      title="Vencimentos"
      description="Tudo o que está sendo acompanhado, do mais urgente para o menos urgente."
      actions={
        <ButtonLink to="/items/new" variant="primary">
          Novo vencimento
        </ButtonLink>
      }
    />
  );

  const filters = (
    <Toolbar>
      {/* `aria-pressed`, not `aria-current="page"` (Codex Round B, B-03): these are not pages.
          They select which lifecycle-status subset of the SAME collection is shown, so
          "current page" announces the wrong concept. Native <button>s in a labelled group -
          deliberately not an ARIA tablist, which would promise a tabpanel and a keyboard
          model that do not exist here. */}
      <div className="ui-filter" role="group" aria-label="Filtrar por status">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} type="button" className="ui-filter__option" aria-pressed={tab.value === status} onClick={() => selectStatus(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>
      <ToolbarSpacer />
      {query.isFetching && !query.isPending && !query.isFetchingNextPage ? <BackgroundRefreshIndicator /> : null}
      <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
        Atualizar
      </Button>
    </Toolbar>
  );

  if (query.isPending) {
    return (
      <>
        {header}
        {filters}
        <Panel>
          <CollectionSkeleton label="Carregando vencimentos…" rows={8} />
        </Panel>
      </>
    );
  }

  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.category === "AUTHORIZATION") {
      return (
        <>
          {header}
          <EmptyState kind="permission-limited" />
        </>
      );
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar os vencimentos.";
    return (
      <>
        {header}
        {filters}
        <ErrorState message={message} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const allItems = query.data.pages.flatMap((page) => page.items);
  const entries: RowEntry[] = sortByDueDateAscending(allItems).map((item) => ({ item, urgency: presentItemUrgency(item, now) }));

  if (entries.length === 0) {
    return (
      <>
        {header}
        {filters}
        <EmptyState
          kind={status === "ACTIVE" ? "true-empty" : "filtered-empty"}
          message={status === "ACTIVE" ? "Nenhum vencimento cadastrado ainda." : "Nenhum vencimento neste status."}
          action={
            status === "ACTIVE" ? (
              <ButtonLink to="/items/new" variant="primary">
                Novo vencimento
              </ButtonLink>
            ) : null
          }
        />
      </>
    );
  }

  const groups: DataTableGroup<RowEntry>[] | undefined =
    status === "ACTIVE"
      ? (
          [
            { id: "overdue", label: "Vencidos", rows: entries.filter((entry) => entry.urgency.group === "overdue") },
            { id: "soon", label: "Vence em breve", rows: entries.filter((entry) => entry.urgency.group === "soon") },
            { id: "later", label: "Demais ativos", rows: entries.filter((entry) => entry.urgency.group === "later") },
          ] as DataTableGroup<RowEntry>[]
        ).filter((group) => group.rows.length > 0)
      : undefined;

  return (
    <>
      {header}
      {filters}
      <Panel>
        <DataTable
          caption={`Vencimentos — ${STATUS_TABS.find((tab) => tab.value === status)?.label ?? ""}`}
          columns={columns}
          groups={groups}
          rows={groups ? undefined : entries}
          rowKey={(entry) => entry.item.itemId}
        />
        {query.hasNextPage ? (
          <Toolbar>
            <ToolbarSpacer />
            <Button variant="secondary" size="sm" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </Button>
          </Toolbar>
        ) : null}
      </Panel>
    </>
  );
}
