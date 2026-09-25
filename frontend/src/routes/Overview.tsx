import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Clock, ClipboardList, Plus, ChevronRight } from "lucide-react";
import { useOrgPath } from "../routing/useOrgPath.js";
import { useDashboardSummary } from "../hooks/useItemsDashboard.js";
import { useItemSearch, useDebouncedValue } from "../hooks/useItemSearch.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { formatAbsoluteDate, presentItemUrgency, sortByDueDateAscending } from "../api/presentation.js";
import { PageHeader } from "../components/ui/Layout.js";
import { ButtonLink, Button } from "../components/ui/Button.js";
import { CollectionSkeleton, ErrorState } from "../components/AsyncStates.js";
import { UrgencyIndicator } from "../components/ui/UrgencyIndicator.js";
import "./Overview.css";

export function Overview() {
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const summary = useDashboardSummary();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const debounced = useDebouncedValue(search);
  const query = useItemSearch("ACTIVE", debounced, filter);
  const list = useRef<HTMLElement>(null);
  useEffect(() => { document.title = "Visão geral · OmniVence"; }, []);
  const items = sortByDueDateAscending(query.data?.pages.flatMap(page => page.items.map(row => row.item)) ?? []).slice(0, 11);
  const metrics = [
    { key: "VENCIDO", label: "Vencidos", count: summary.data?.itemsOverdueCount, icon: AlertCircle, tone: "critical" },
    { key: "VENCENDO", label: "Vencem em 7 dias", count: summary.data?.itemsExpiringSoonCount, icon: Clock, tone: "warning" },
    { key: "", label: "Em acompanhamento", count: summary.data?.activeItemsCount, icon: ClipboardList, tone: "accent" },
  ];
  function prioritize() { setFilter("VENCIDO"); list.current?.scrollIntoView({ block: "start" }); list.current?.focus(); }
  return <div className="ov-overview">
    <PageHeader title="Visão geral" above={<span className="ov-eyebrow">Seu espaço de trabalho</span>} description="Seus vencimentos ativos, do mais para o menos urgente."
      actions={role !== "VIEWER" && <ButtonLink to={orgPath("/items/new")} variant="primary" icon={Plus}>Novo vencimento</ButtonLink>} />
    <section className="ov-overview-hero" aria-labelledby="priorities-heading">
      <div><span className="ov-eyebrow">Prioridades da equipe</span><h2 id="priorities-heading">Você sabe o que precisa de atenção agora.</h2><p>Comece pelos itens vencidos e acompanhe o próximo passo de cada obrigação.</p></div>
      <button type="button" onClick={prioritize}>Ver prioridades <ChevronRight size={16} aria-hidden="true" /></button>
    </section>
    <section aria-labelledby="metrics-heading">
      <h2 className="ov-overview-section-title" id="metrics-heading">Panorama de vencimentos</h2>
      <div className="ov-overview-metrics">{metrics.map(metric => <button key={metric.label} className={"ov-overview-metric " + metric.tone} aria-pressed={filter === metric.key} onClick={() => setFilter(metric.key)} aria-label={metric.count === undefined ? metric.label + "; carregando" : metric.count.toLocaleString("pt-BR") + " " + metric.label + "; filtrar lista"}>
        <span className="ov-overview-metric-icon"><metric.icon size={23} aria-hidden="true" /></span>
        <span><strong>{metric.count === undefined ? "—" : metric.count.toLocaleString("pt-BR")}</strong><span>{metric.label}{summary.data?.approximate ? " (parcial)" : ""}</span></span>
      </button>)}</div>
      {summary.isError && <ErrorState message="Não foi possível carregar os contadores de atenção agora." onRetry={() => void summary.refetch()} />}
    </section>
    <section ref={list} tabIndex={-1} aria-labelledby="attention-heading">
      <div className="ov-overview-list-heading"><div><h2 id="attention-heading">O que precisa de atenção</h2><p>Vencimentos ordenados pela data mais próxima</p></div>
        <div className="ov-overview-controls">
          <input type="search" aria-label="Buscar vencimento" placeholder="Buscar vencimento" value={search} onChange={e => setSearch(e.target.value)} />
          <select aria-label="Filtrar vencimentos" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Todos</option><option value="VENCIDO">Vencidos</option><option value="VENCENDO">Próximos 7 dias</option></select>
        </div>
      </div>
      <div className="ov-overview-list" aria-busy={query.isFetching}>
        {query.isPending ? <CollectionSkeleton label="Carregando seus vencimentos…" /> : query.isError && !query.data ? <ErrorState message="Não foi possível carregar a visão geral. Tente novamente." onRetry={() => void query.refetch()} /> :
          items.length ? <table><caption className="u-visually-hidden">Vencimentos ativos, do mais para o menos urgente</caption><thead><tr><th>Vencimento</th><th>Data</th><th>Urgência</th><th><span className="u-visually-hidden">Detalhe</span></th></tr></thead>
            <tbody>{items.map(item => <tr key={item.itemId}>
              <td><Link to={orgPath("/items/" + item.itemId)}>{item.name}</Link>{(item.issuer || item.category) && <small>{[item.issuer, item.category].filter(Boolean).join(" · ")}</small>}</td>
              <td>{formatAbsoluteDate(item.dueDate)}</td><td><UrgencyIndicator urgency={presentItemUrgency(item, new Date())} /></td><td><ChevronRight size={16} aria-hidden="true" /></td>
            </tr>)}</tbody></table> :
            <div className="ov-overview-empty"><h3>{search || filter ? "Nenhum vencimento encontrado para esta busca." : "Nenhum vencimento em acompanhamento"}</h3>{search || filter ? <Button onClick={() => { setSearch(""); setFilter(""); }}>Limpar filtros</Button> : <p>Crie o primeiro registro para acompanhar seus prazos.</p>}</div>}
        {query.isError && query.data && <ErrorState message="Não foi possível atualizar a lista. Os registros carregados foram mantidos." onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())} />}
        <footer><span aria-live="polite">{search || filter ? items.length + " resultado(s) nesta visualização" : summary.data ? "Exibindo " + items.length + " de " + summary.data.activeItemsCount.toLocaleString("pt-BR") + " vencimentos" + (summary.data.approximate ? " (total parcial)" : "") : items.length + " vencimentos nesta visualização"}</span><Link to={orgPath("/items") + (filter || debounced ? "?" + new URLSearchParams({ search: debounced, urgency: filter }).toString() : "")}>Ver todos os vencimentos</Link></footer>
        {query.hasNextPage && items.length < 11 && <Button onClick={() => void query.fetchNextPage()} pending={query.isFetchingNextPage}>Carregar mais resultados</Button>}
      </div>
    </section>
  </div>;
}
