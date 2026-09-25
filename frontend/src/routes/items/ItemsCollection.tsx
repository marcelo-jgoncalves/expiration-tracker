import { useMemo, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, RotateCw, CalendarClock } from "lucide-react";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useDashboardSummary } from "../../hooks/useItemsDashboard.js";
import { useItemSearch, useDebouncedValue } from "../../hooks/useItemSearch.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { OmniHero } from "../../components/OmniHero.js";
import "./ItemsCollection.css";
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
import { PageHeader, Panel, StatusFilter, Toolbar, ToolbarSpacer } from "../../components/ui/Layout.js";
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

function buildColumns(now: Date, orgPath: (path: string) => string, canRenew: boolean): DataTableColumn<RowEntry>[] {
  return [
    {
      key: "name",
      header: "Vencimento",
      primary: true,
      render: ({ item }) => (
        <>
          <Link to={orgPath(`/items/${item.itemId}`)}>{item.name}</Link>
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
          {item.status === "ACTIVE" && <CellSecondary>{formatRelativeDueContext(item.dueDate, now)}</CellSecondary>}
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
        item.status === "ACTIVE" && canRenew ? (
          <ButtonLink to={orgPath(`/items/${item.itemId}/renew`)} variant="secondary" size="sm" icon={RefreshCw} aria-label={`Renovar ${item.name}, ${formatAbsoluteDate(item.dueDate)}`}>
            Renovar
          </ButtonLink>
        ) : null,
    },
  ];
}

export function ItemsCollection() {
  const orgPath = useOrgPath();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const status: ExpirationItemStatus = isKnownStatus(statusParam) ? statusParam : "ACTIVE";
  const role = useCurrentMembershipRole();
  const summary = useDashboardSummary();
  const search = searchParams.get("search") ?? "";
  const urgency = searchParams.get("urgency") ?? "";
  const debounced = useDebouncedValue(search);
  const query = useItemSearch(status, debounced, status === "ACTIVE" ? urgency : "");
  useEffect(() => { document.title = "Vencimentos · OmniVence"; }, []);
  // Computed once per render, not re-derived per row - a long-lived tab drifting a few
  // minutes stale between renders is an accepted trade-off (Overview.tsx's existing pattern).
  const now = useMemo(() => new Date(), []);
  const columns = useMemo(() => buildColumns(now, orgPath, role !== "VIEWER"), [now, orgPath, role]);

  function selectStatus(next: ExpirationItemStatus) {
    setSearchParams(previous => { const params = new URLSearchParams(previous); params.set("status", next); params.delete("urgency"); return params; });
  }

  const header = (
    <>
    <PageHeader
      title="Vencimentos"
      above={<span className="ov-eyebrow">Prazos e acompanhamento</span>}
      description="Tudo o que está sendo acompanhado, do mais para o menos urgente."
      actions={
        role !== "VIEWER" && <ButtonLink to={orgPath("/items/new")} variant="primary" icon={Plus}>
          Novo vencimento
        </ButtonLink>
      }
    />
    <OmniHero icon={CalendarClock} eyebrow="Seu panorama" title="Prazos claros. Próximos passos visíveis." description="Comece pelo que venceu, acompanhe o que está chegando e mantenha o histórico organizado."
      summary={<><strong>{summary.data ? summary.data.activeItemsCount.toLocaleString("pt-BR") : "—"}</strong><span>ativos{summary.data?.approximate ? " (parcial)" : ""}</span></>} />
    </>
  );

  const filters = (
    <Toolbar>
      <StatusFilter options={STATUS_TABS} value={status} onChange={selectStatus} />
      <ToolbarSpacer />
      <input className="ov-items-search" type="search" aria-label="Buscar vencimento" placeholder="Buscar vencimento" value={search} onChange={e => setSearchParams(previous => { const params = new URLSearchParams(previous); params.set("search", e.target.value); return params; }, { replace: true })} />
      {urgency && <Button size="sm" onClick={() => setSearchParams(previous => { const params = new URLSearchParams(previous); params.delete("urgency"); return params; })}>Limpar filtro de urgência</Button>}
      {query.isFetching && !query.isPending && !query.isFetchingNextPage ? <BackgroundRefreshIndicator /> : null}
      <Button variant="secondary" size="sm" icon={RotateCw} disabled={query.isFetching} onClick={() => { void query.refetch(); void summary.refetch(); }}>
        {query.isFetching ? "Atualizando…" : "Atualizar"}
      </Button>
    </Toolbar>
  );

  if (query.isPending) {
    return (
      <div className="ov-items">
        {header}
        {filters}
        <Panel>
          <CollectionSkeleton label="Carregando vencimentos…" rows={8} />
        </Panel>
      </div>
    );
  }

  if (query.isError && !query.data) {
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
      <div className="ov-items">
        {header}
        {filters}
        <ErrorState message={message} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const allItems = query.data.pages.flatMap((page) => page.items.map(row => row.item));
  const entries: RowEntry[] = (status === "ACTIVE" ? sortByDueDateAscending(allItems) : [...allItems].sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.itemId.localeCompare(b.itemId))).map((item) => ({ item, urgency: presentItemUrgency(item, now) }));

  if (entries.length === 0 && !query.hasNextPage) {
    return (
      <div className="ov-items">
        {header}
        {filters}
        <EmptyState
          kind={status === "ACTIVE" ? "true-empty" : "filtered-empty"}
          message={search ? "Nenhum vencimento encontrado para esta busca." : status === "ACTIVE" ? "Nenhum vencimento ativo." : status === "ARCHIVED" ? "Nenhum vencimento arquivado." : "Nenhum vencimento renovado."}
          action={
            status === "ACTIVE" && role !== "VIEWER" ? (
              <ButtonLink to={orgPath("/items/new")} variant="primary" icon={Plus}>
                Novo vencimento
              </ButtonLink>
            ) : null
          }
        />
      </div>
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
    <div className="ov-items">
      {header}
      {filters}
      <Panel>
        {query.isError && <ErrorState message="Não foi possível atualizar os resultados. Os registros carregados foram mantidos." onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())} />}
        {query.hasNextPage && <p className="ov-items-partial">Contagens de grupos referentes aos registros carregados.</p>}
        <DataTable
          caption={`Vencimentos — ${STATUS_TABS.find((tab) => tab.value === status)?.label ?? ""}`}
          columns={columns}
          groups={groups}
          rows={groups ? undefined : entries}
          rowKey={(entry) => entry.item.itemId}
        />
        <p className="ov-items-footer" aria-live="polite">{entries.length.toLocaleString("pt-BR")} {entries.length === 1 ? "registro" : "registros"} nesta visualização</p>
        {query.hasNextPage ? (
          <Toolbar>
            <ToolbarSpacer />
            <Button variant="secondary" size="sm" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </Button>
          </Toolbar>
        ) : null}
      </Panel>
    </div>
  );
}
