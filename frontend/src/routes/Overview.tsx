/**
 * Overview — "o que precisa da minha atenção?" (mission §29).
 *
 * The query, the ACTIVE-only scope and the due-date ascending ordering are exactly what the
 * approved Core Expiration Vertical Slice shipped. Decorative KPI tiles/donut charts remain
 * rejected (mission §29's "KPI theater", VL-G14) — a count that is not a real link earns
 * nothing. The attention row below answers D-08 of visual-language-and-design-system.md ("um
 * contador acionável ajudaria a priorizar?") with exactly that: every count is a link into the
 * group it counts, never a bare number.
 *
 * A separate "ver todos os vencimentos" affordance was dropped (2026-09-20, Marcelo): its target
 * (`/items`) is identical to the "em acompanhamento" card's own link, so once that card carries a
 * real count (pendência #14) the two become the exact same CTA twice. A future "ver todos" only
 * earns its own affordance again if it covers a scope neither card does today (e.g. every status,
 * not just ACTIVE).
 *
 * ADR-0015/pendência #14 (NEXT_SESSION_PROMPT.md, PENDING_PROTOCOL_REVIEW — decisions-log.md):
 * the 3 attention counts now come from `useDashboardSummary()` (`GET /dashboard/summary`,
 * `DashboardService.getSummary`'s `itemsOverdueCount`/`itemsExpiringSoonCount`/
 * `activeItemsCount`), a real tenant-wide aggregate — never derived from `useItemsDashboardBounded`
 * (only a bounded 30-item page, which would silently undercount past 30 active items).
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useOrgPath } from "../routing/useOrgPath.js";
import type { ExpirationItem } from "../api/types.js";
import { formatAbsoluteDate, formatBytesAsGb, presentItemUrgency, sortByDueDateAscending } from "../api/presentation.js";
import { CollectionSkeleton, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { ApiError } from "../api/errors.js";
import { AlertCircle, Clock, ClipboardList, Plus } from "lucide-react";
import { PageHeader, Panel, AttentionRow, type AttentionItem } from "../components/ui/Layout.js";
import { ButtonLink } from "../components/ui/Button.js";
import { DataTable, type DataTableColumn } from "../components/ui/DataTable.js";
import { UrgencyIndicator } from "../components/ui/UrgencyIndicator.js";
import { useItemsDashboardBounded, useDashboardSummary } from "../hooks/useItemsDashboard.js";
import { useStorageQuota } from "../hooks/useStorageQuota.js";

/**
 * A03 (D-2xx addendum) conditional storage card — renders ONLY when `warningLevel` is
 * WARNING/CRITICAL/OVER (>=80% of `limitBytes` committed); below that threshold this returns
 * `null` and the card never appears at all (spec: "nunca aparece vazio ou desabilitado"). A
 * failed/pending fetch also renders nothing here — this is a secondary, non-blocking signal on
 * a page whose primary content (the items table below) must never wait on it.
 */
function StorageQuotaCard({ orgPath }: { orgPath: (path: string) => string }) {
  const query = useStorageQuota();
  if (!query.data) return null;
  const usage = query.data.usage;
  if (usage.warningLevel === "OK") return null;

  const percent = Math.round(usage.usedPercent * 100);
  return (
    <Panel padded>
      <p>
        <strong>Armazenamento:</strong> {formatBytesAsGb(usage.usedBytes + usage.reservedBytes)} de {formatBytesAsGb(usage.limitBytes)} usados ({percent}%)
      </p>
      <progress value={Math.min(usage.usedPercent, 1)} max={1} aria-label="Percentual de armazenamento utilizado" style={{ width: "100%" }} />
      {usage.warningLevel === "OVER" ? <p>Novos uploads bloqueados até liberar espaço — arquivos existentes não são afetados.</p> : null}
      <p>
        <Link to={orgPath("/settings")}>Gerenciar armazenamento</Link>
      </p>
    </Panel>
  );
}

export function Overview() {
  // Wave B2B-10: previously duplicated apiClient.get() call inline with an unscoped queryKey
  // (["items","dashboard","ACTIVE"]) - the one org-scoping gap the Round 2 inventory found that
  // wasn't already covered by a shared hook. Now goes through the same org-scoped hook family
  // as the Items Collection screen (D-136/D-E split the hook in two - this screen wants a
  // single bounded read, never the paginated "load more" the Collection needs).
  const query = useItemsDashboardBounded("ACTIVE");
  const summaryQuery = useDashboardSummary();
  const now = useMemo(() => new Date(), []);
  const orgPath = useOrgPath();

  const columns: DataTableColumn<ExpirationItem>[] = [
    {
      key: "name",
      header: "Vencimento",
      primary: true,
      render: (item) => <Link to={orgPath(`/items/${item.itemId}`)}>{item.name}</Link>,
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
      description="Seus vencimentos ativos, do mais para o menos urgente."
      actions={
        <ButtonLink to={orgPath("/items/new")} variant="primary" icon={Plus}>
          Novo vencimento
        </ButtonLink>
      }
    />
  );

  if (query.isPending) {
    return (
      <>
        {header}
        <StorageQuotaCard orgPath={orgPath} />
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
        <StorageQuotaCard orgPath={orgPath} />
        <ErrorState message={message} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const items = sortByDueDateAscending(query.data.items);

  if (items.length === 0) {
    return (
      <>
        {header}
        <StorageQuotaCard orgPath={orgPath} />
        <EmptyState
          kind="true-empty"
          message="Nenhum vencimento cadastrado ainda. Cadastre o primeiro para começar a acompanhar prazos."
          action={
            <ButtonLink to={orgPath("/items/new")} variant="primary" icon={Plus}>
              Novo vencimento
            </ButtonLink>
          }
        />
      </>
    );
  }

  // Real tenant-wide aggregate (D-308 pendência #14, D-332 revisão adversarial) - never gates
  // the page's own loading state (removed from the `isPending` check above, D-332 achado real:
  // this secondary widget was blocking the whole page, including the items table, contradicting
  // this comment's own "nunca bloqueando a tabela principal"). `summaryQuery.data` is undefined
  // both while pending and on error, but the render below (D-332 Rodada 2 achado, Codex) treats
  // them differently: pending renders nothing (still in flight, not yet a failure), only a
  // settled query with no data renders the InlineNotice.
  // `approximate: true` (D-332 achado real: `Overview.tsx` computed `attention` but never read
  // this field, so a truncated page-cap search could render a misleadingly exact "0") appends
  // "(parcial)" to every label - the shared flag covers all 3 cards uniformly (a per-card
  // breakdown would need per-sub-count tracking in `DashboardService`, out of proportion for
  // this fix - see round-1-claude-proposal.md achado 3).
  const attention: AttentionItem[] | undefined = summaryQuery.data
    ? [
        { count: summaryQuery.data.itemsOverdueCount, label: summaryQuery.data.approximate ? "vencidos (parcial)" : "vencidos", tone: "critical", icon: AlertCircle, to: orgPath("/items") },
        { count: summaryQuery.data.itemsExpiringSoonCount, label: summaryQuery.data.approximate ? "vencem em 7 dias (parcial)" : "vencem em 7 dias", tone: "warning", icon: Clock, to: orgPath("/items") },
        { count: summaryQuery.data.activeItemsCount, label: summaryQuery.data.approximate ? "em acompanhamento (parcial)" : "em acompanhamento", tone: "accent", icon: ClipboardList, to: orgPath("/items") },
      ]
    : undefined;

  return (
    <>
      {header}
      <StorageQuotaCard orgPath={orgPath} />
      {attention ? (
        <AttentionRow items={attention} />
      ) : summaryQuery.isPending ? null : (
        // D-332 achado real (Codex Rodada 2): antes desta mudança, `summaryQuery` ainda
        // pendente (não errado, só mais lento que a tabela) já disparava este aviso de erro -
        // um falso positivo enquanto os dados reais ainda estavam a caminho. `isPending` aqui
        // nunca reintroduz o bloqueio da Rodada 1 (a tabela acima não depende disto).
        <InlineNotice tone="warning" announce="none">
          Não foi possível carregar os contadores de atenção agora.
        </InlineNotice>
      )}
      <Panel>
        <DataTable caption="Vencimentos ativos, do mais para o menos urgente" columns={columns} rows={items} rowKey={(item) => item.itemId} />
      </Panel>
    </>
  );
}
