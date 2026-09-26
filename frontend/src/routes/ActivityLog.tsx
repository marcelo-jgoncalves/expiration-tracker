import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { History, Filter, RefreshCw, Search, RotateCcw, User, Cog, FileText } from "lucide-react";
import { OmniHero } from "../components/OmniHero.js";
import { useMembers } from "../hooks/useMembers.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useActivity } from "../hooks/useActivity.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { ApiError } from "../api/errors.js";
import type { ActivityEntry, Member, MembershipRole } from "../api/types.js";
import { CollectionSkeleton, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { PageHeader, Panel, Section, Toolbar, ToolbarSpacer } from "../components/ui/Layout.js";
import { DataTable, CellSecondary, type DataTableColumn } from "../components/ui/DataTable.js";
import { Button } from "../components/ui/Button.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import "./ActivityLog.css";

/** ADMIN/OWNER only - mirrors the backend's ADMIN_ROLES tier for `activity:read`
 * (authorization.ts). */
function canViewActivity(role: MembershipRole | undefined): boolean {
  return role === "ADMIN" || role === "OWNER";
}

const RESOURCE_LABELS: Record<string, string> = {
  ExpirationItem: "Vencimento", TrackedSubject: "Fornecedor", Membership: "Membro",
  Invitation: "Convite", Tenant: "Organização", RequirementAssignment: "Exigência",
  DocumentRequest: "Solicitação de documento", DocumentRequestDeliveryPreference: "Entrega de documentos",
  ExpirationExport: "Exportação de vencimentos",
};
const ACTION_LABELS: Record<string, string> = {
  CREATE: "Criou registro", UPDATE: "Atualizou registro", DELETE: "Excluiu registro", ARCHIVE: "Arquivou registro",
  RENEW: "Renovou vencimento", ROLE_CHANGED: "Alterou acesso de membro", MEMBER_REMOVED: "Removeu membro",
  MEMBER_LEFT: "Saiu da organização", INVITATION_CREATED: "Criou convite", INVITATION_REVOKED: "Cancelou convite",
  INVITATION_ACCEPTED: "Aceitou convite", ASSIGN_REQUIREMENT: "Atribuiu exigência", LINK_ITEM: "Vinculou vencimento",
  UNLINK_ITEM: "Desvinculou vencimento", DELETE_REQUIREMENT: "Excluiu exigência", EXPORT: "Exportou vencimentos",
};
function ActionBadge({ entry }: { entry: ActivityEntry }) {
  const verb = ({ CREATE: "Criou", UPDATE: "Atualizou", DELETE: "Excluiu", ARCHIVE: "Arquivou" } as Record<string, string>)[entry.action];
  const resource = RESOURCE_LABELS[entry.resourceType];
  return <span className="activity-action" title={entry.action}>{verb && resource ? `${verb} ${resource.toLocaleLowerCase("pt-BR")}` : ACTION_LABELS[entry.action] ?? "Registrou uma ação"}</span>;
}
function ActorCell({ entry, members }: { entry: ActivityEntry; members: Member[] }) {
  const system = entry.actor.type === "SYSTEM";
  const member = system ? undefined : members.find(candidate => candidate.userId === entry.actor.userId);
  const Icon = system ? Cog : User;
  return <div className="activity-actor">
    <span className="activity-actor__avatar" aria-hidden="true"><Icon size={16} /></span>
    <div><strong>{system ? "Sistema" : member?.displayName || "Usuário não disponível"}</strong>
      <span>{system ? "Sem e-mail de usuário" : member?.email || "E-mail indisponível"}</span>
      <small>{entry.actor.userId ? `ID: ${entry.actor.userId}` : "ID indisponível"}</small>
      {member && <small>Perfil atual</small>}
    </div>
  </div>;
}

function ResourceCell({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="activity-resource">
      <span className="activity-resource__icon" aria-hidden="true">
        <FileText size={15} strokeWidth={2} />
      </span>
      <div>
        <div>{RESOURCE_LABELS[entry.resourceType] ?? "Outro recurso"}</div>
        {entry.resourceId ? <CellSecondary>{entry.resourceId}</CellSecondary> : null}
      </div>
    </div>
  );
}

export function ActivityLog() {
  const { organizationId } = useActiveOrganization();
  const role = useCurrentMembershipRole();
  useEffect(() => { document.title = "Atividade · OmniVence"; }, []);
  if (role !== "ADMIN" && role !== "OWNER") return <><PageHeader title="Atividade" /><EmptyState kind="permission-limited" message="Você não tem permissão para consultar a atividade desta organização." /></>;
  return <ActivityContent key={organizationId} />;
}
function ActivityContent() {
  const members = useMembers();
  const role = useCurrentMembershipRole();
  const [searchParams] = useSearchParams();
  // #16 finding (2026-09-20): entry points like ItemDetail's "Histórico de auditoria" card link
  // here with ?resourceId=<itemId> so the log opens pre-filtered to that one record - seeded
  // once from the URL into both the draft inputs and the applied filter, editable afterward like
  // the other two filters.
  const seededResourceId = searchParams.get("resourceId") ?? "";
  // Draft (what the inputs show) vs applied (what actually drives the query, protótipo
  // `expiration-tracker-log-atividade(1).html`, Marcelo 2026-09-22): every keystroke used to
  // re-fire GET /activity immediately (no debounce) - an explicit "Aplicar filtros" avoids a
  // network round-trip per character typed into "Recurso (ID)".
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [draftMonth, setDraftMonth] = useState(currentMonth);
  const [draftResourceType, setDraftResourceType] = useState("");
  const [draftResourceId, setDraftResourceId] = useState(seededResourceId);
  const [month, setMonth] = useState(currentMonth);
  const [resourceType, setResourceType] = useState("");
  const [resourceId, setResourceId] = useState(seededResourceId);
  const [announcement, setAnnouncement] = useState("");
  const previousPageCount = useRef(0);
  const exhaustedTextRef = useRef<HTMLParagraphElement>(null);
  const wasExhausted = useRef(false);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMonth(draftMonth || currentMonth);
    setResourceType(draftResourceType);
    setResourceId(draftResourceId);
  }

  function clearFilters() {
    setDraftMonth(currentMonth);
    setDraftResourceType("");
    setDraftResourceId("");
    setMonth(currentMonth);
    setResourceType("");
    setResourceId("");
  }

  // `month` holds the native <input type="month"> value (YYYY-MM, ISO - the browser renders it
  // locale-formatted, pt-BR shows it as a real month/year picker, never a raw digit string the
  // user has to already know the convention for). The backend contract is YYYYMM (no dash).
  const monthFilter = /^\d{4}-\d{2}$/.test(month) ? month.replace("-", "") : undefined;
  const resourceTypeFilter = resourceType.trim() || undefined;
  const resourceIdFilter = resourceId.trim() || undefined;

  const query = useActivity({ month: monthFilter, resourceType: resourceTypeFilter, resourceId: resourceIdFilter, enabled: canViewActivity(role) });

  const header = <><PageHeader above={<span className="ov-eyebrow">RASTREABILIDADE DA ORGANIZAÇÃO</span>} title="Atividade" description="Saiba quem realizou cada ação, em qual recurso e quando aconteceu." /><OmniHero icon={History} eyebrow="HISTÓRICO DE AÇÕES" title="Clareza em cada mudança." description="Consulte os registros da organização com identificação completa de quem executou cada ação." /></>;

  const pageCount = query.data?.pages.length ?? 0;
  useEffect(() => {
    if (pageCount > previousPageCount.current) {
      const newEntries = query.data?.pages[pageCount - 1]?.entries.length ?? 0;
      setAnnouncement(`${newEntries} novo(s) evento(s) carregado(s).`);
    }
    previousPageCount.current = pageCount;
  }, [pageCount, query.data]);

  const isExhausted = !query.hasNextPage && (query.data?.pages.some((p) => p.entries.length > 0) ?? false);
  useEffect(() => {
    if (isExhausted && !wasExhausted.current) {
      exhaustedTextRef.current?.focus();
    }
    wasExhausted.current = isExhausted;
  }, [isExhausted]);

  if (role !== undefined && !canViewActivity(role)) {
    return (
      <>
        {header}
        <Panel>
          <EmptyState kind="permission-limited" message="Você não tem permissão para ver a trilha de atividade. Fale com um administrador da organização." />
        </Panel>
      </>
    );
  }

  if (query.isPending) {
    return (
      <>
        {header}
        <Panel>
          <CollectionSkeleton label="Carregando atividade…" />
        </Panel>
      </>
    );
  }

  // Only an INITIAL load failure replaces the whole page - a `fetchNextPage()` failure also sets
  // this infinite query's overall `isError`, but preserves every already-loaded page in `data`
  // (see this file's header comment, Codex round finding).
  if (query.isLoadingError || !query.data) {
    const message = query.error instanceof ApiError ? query.error.message : "Não foi possível carregar o log de atividade.";
    return (
      <>
        {header}
        <ErrorState message={message} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const entries = query.data.pages.flatMap((page) => page.entries);

  const columns: DataTableColumn<ActivityEntry>[] = [
    { key: "actor", header: "Quem executou", primary: true, render: (e) => <ActorCell entry={e} members={members.data?.members ?? []} /> },
    { key: "action", header: "Ação", render: (e) => <ActionBadge entry={e} /> },
    { key: "resource", header: "Recurso", render: (e) => <ResourceCell entry={e} /> },
    { key: "occurredAt", header: "Quando", numeric: true, render: (e) => <div className="activity-date"><strong>{new Date(e.occurredAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</strong><span>às {new Date(e.occurredAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></div> },
  ];

  return (
    <>
      {header}
      <Section heading="Encontre um evento" description="Combine os filtros para localizar uma alteração específica." headingId="activity-filters" icon={Filter}>
        <Panel padded>
          <form className="ui-form" onSubmit={applyFilters}>
            <div className="activity-filters__grid">
              <label className="activity-filter"><span>Mês</span><input aria-label="Mês" type="month" required value={draftMonth} onChange={event => setDraftMonth(event.target.value)} /></label>
              <label className="activity-filter"><span>Pessoa, e-mail ou ID do usuário</span><input disabled placeholder="Busca por pessoa indisponível" aria-describedby="activity-limitations" /></label>
              <label className="activity-filter"><span>Tipo de recurso</span><select value={draftResourceType} onChange={event => setDraftResourceType(event.target.value)}><option value="">Todos os recursos</option>{Object.entries(RESOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="activity-filter"><span>ID do recurso</span><input placeholder="Ex.: item_01…" value={draftResourceId} onChange={event => setDraftResourceId(event.target.value)} /></label>
            </div>
            <p id="activity-limitations" className="activity-limitations">Consulta por mês. A busca em todos os meses e por pessoa ainda não está disponível. O ID do recurso deve ser completo.</p>
            <div className="ui-form__actions">
              <Button type="submit" variant="primary" icon={Search}>
                Aplicar filtros
              </Button>
              <Button type="button" variant="secondary" icon={RotateCcw} onClick={clearFilters}>
                Limpar filtros
              </Button>
            </div>
          </form>
        </Panel>
      </Section>
      <Section heading="Eventos" headingId="activity-events" description="Do mais recente para o mais antigo." annotation={`(${entries.length} carregados)`}>
        <Panel>
          <Toolbar>
            <ToolbarSpacer />
            <Button variant="tertiary" size="sm" icon={RefreshCw} onClick={() => void query.refetch()} pending={query.isRefetching}>
              {query.isRefetching ? "Atualizando…" : "Atualizar"}
            </Button>
          </Toolbar>
          {entries.length === 0 ? (
            <EmptyState kind="true-empty" message="Nenhum evento encontrado nesta consulta. Revise os filtros ou carregue a próxima página, se disponível." />
          ) : (
            <DataTable caption="Eventos de atividade" columns={columns} rows={entries} rowKey={(e) => e.auditEventId} />
          )}
          <div aria-live="polite" className="u-visually-hidden">
            {announcement}
          </div>
          {query.isFetchNextPageError ? (
            <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void query.fetchNextPage()}>Tentar novamente</Button>}>
              Não foi possível carregar mais eventos.
            </InlineNotice>
          ) : null}
          {query.hasNextPage ? (
            <Button variant="tertiary" onClick={() => void query.fetchNextPage()} pending={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </Button>
          ) : entries.length > 0 ? (
            <p ref={exhaustedTextRef} tabIndex={-1}>
              Todos os eventos foram carregados.
            </p>
          ) : null}
        </Panel>
      </Section>
    </>
  );
}

