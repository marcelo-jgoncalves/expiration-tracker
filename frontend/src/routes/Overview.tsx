/**
 * Overview — "o que precisa da minha atenção?" (mission §29).
 *
 * Visual Language milestone: restyled, NOT redesigned. The query, the ACTIVE-only scope, the
 * due-date ascending ordering and the "ver todos" affordance are exactly what the approved
 * Core Expiration Vertical Slice shipped. Specifically NOT added: KPI tiles / donut charts /
 * counters across the top. Those would be new information architecture invented by a visual
 * milestone with no evidence behind it (mission §29's "KPI theater", VL-G14) — an attention
 * summary that answers the question directly is the approved design, and a number that is not
 * linked to a task earns nothing.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ExpirationItem } from "../api/types.js";
import { formatAbsoluteDate, presentItemUrgency, sortByDueDateAscending } from "../api/presentation.js";
import { CollectionSkeleton, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { ApiError } from "../api/errors.js";
import { PageHeader, Panel } from "../components/ui/Layout.js";
import { ButtonLink } from "../components/ui/Button.js";
import { DataTable, type DataTableColumn } from "../components/ui/DataTable.js";
import { UrgencyIndicator } from "../components/ui/UrgencyIndicator.js";
import { useItemsDashboardBounded } from "../hooks/useItemsDashboard.js";

export function Overview() {
  // Wave B2B-10: previously duplicated apiClient.get() call inline with an unscoped queryKey
  // (["items","dashboard","ACTIVE"]) - the one org-scoping gap the Round 2 inventory found that
  // wasn't already covered by a shared hook. Now goes through the same org-scoped hook family
  // as the Items Collection screen (D-136/D-E split the hook in two - this screen wants a
  // single bounded read, never the paginated "load more" the Collection needs).
  const query = useItemsDashboardBounded("ACTIVE");
  const now = useMemo(() => new Date(), []);

  const columns: DataTableColumn<ExpirationItem>[] = [
    {
      key: "name",
      header: "Vencimento",
      primary: true,
      render: (item) => <Link to={`/items/${item.itemId}`}>{item.name}</Link>,
    },
    {
      key: "dueDate",
      header: "Data",
      numeric: true,
      // Absolute date always available (mission §19) — the relative context lives in the
      // urgency column right next to it, never replacing the real date.
      render: (item) => formatAbsoluteDate(item.dueDate),
    },
    {
      key: "urgency",
      header: "Urgência",
      // Urgency, not lifecycle status. This surface is scoped to ACTIVE items only (see the
      // query above and the page description), so a "Situação" column here would read
      // "Ativo" on every single row — noise, not signal. Both concepts remain
      // representable and both ARE shown side by side on the Collection, where the status
      // filter makes lifecycle status a real variable (mission §32).
      render: (item) => <UrgencyIndicator urgency={presentItemUrgency(item, now)} />,
    },
  ];

  const header = (
    <PageHeader
      title="Visão geral"
      description="Seus vencimentos ativos, do mais urgente para o menos urgente."
      actions={
        <ButtonLink to="/items/new" variant="primary">
          Novo vencimento
        </ButtonLink>
      }
    />
  );

  if (query.isPending) {
    return (
      <>
        {header}
        <Panel>
          <CollectionSkeleton label="Carregando seus vencimentos…" />
        </Panel>
      </>
    );
  }

  if (query.isError) {
    const message = query.error instanceof ApiError ? query.error.message : "Não foi possível carregar seus vencimentos.";
    return (
      <>
        {header}
        <ErrorState message={message} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const items = sortByDueDateAscending(query.data.items);

  if (items.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          kind="true-empty"
          message="Nenhum vencimento cadastrado ainda. Cadastre o primeiro para começar a acompanhar prazos."
          action={
            <ButtonLink to="/items/new" variant="primary">
              Novo vencimento
            </ButtonLink>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <Panel>
        <DataTable caption="Vencimentos ativos, do mais urgente para o menos urgente" columns={columns} rows={items} rowKey={(item) => item.itemId} />
      </Panel>
      <p>
        <Link to="/items">Ver todos os vencimentos</Link>
      </p>
    </>
  );
}
