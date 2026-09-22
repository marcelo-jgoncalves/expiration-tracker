/**
 * A23 — Log de auditoria (Block 10, D-2xx). Convergence pass over the pre-existing minimal
 * `ActivityLog` (D-149) toward the audited spec (`A23-log-auditoria.md`), not first authorship —
 * `activity:read`, ADMIN_ROLES, same tier/gate as before, untouched.
 *
 * REAL deviations from the spec, confirmed directly against `activity-service.ts`'s
 * `ListActivityQuery` before changing anything (never guessed): the backend supports only
 * `month`/`resourceType` filters (both already real, kept as-is) — there is NO actor filter, NO
 * action filter, and NO arbitrary date-range filter, despite the spec naming all four. The spec
 * itself already names this ("não modelado em detalhe neste protótipo") — cursor-based pagination
 * (mandatory per the spec) was already real and is unchanged. Resource entries render as plain
 * text (resourceType + resourceId), never a link to a detail screen — this app has no generic
 * resource-detail routing keyed by an arbitrary resourceType (confirmed: `Members.tsx` itself only
 * ever shows a raw `userId`, never a resolved display name, for exactly the same reason) — this is
 * a real, out-of-scope gap, not a mechanical omission.
 *
 * What actually changed in this pass: prose-line rendering became a real `DataTable` (Ator/Ação/
 * Recurso/Quando columns, per spec), the action code renders in `<code>`, "Carregar mais" now
 * turns into static "Todos os eventos foram carregados." text once the feed is exhausted (focus
 * moves there so it's never silently lost), and a new page's arrival is announced with its own
 * delta count via `aria-live`.
 *
 * Codex review round (Block 10) findings, fixed:
 *  - A `fetchNextPage()` failure used to blank the ENTIRE already-loaded table (checked the
 *    infinite query's overall `isError`, which TanStack Query v5 also sets for a next-page
 *    failure while still preserving `data`) — now only a genuine INITIAL-load failure
 *    (`isLoadingError`) replaces the page; a next-page failure keeps every already-loaded row
 *    visible and surfaces an inline, dismissable-by-retry notice instead (matches the spec's own
 *    "não perde as linhas já carregadas" requirement exactly).
 *  - "Usuário removido" claimed a specific cause (account deletion) the data can't actually prove
 *    - the real event contract requires `userId` for a USER actor even after removal, so a
 *      missing `userId` only ever happens for malformed/legacy data, never a real removed
 *      account. Reworded to the honest "Usuário não identificado".
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Filter, RefreshCw, Search, RotateCcw, User, Cog, FileText } from "lucide-react";
import { useActivity } from "../hooks/useActivity.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { ApiError } from "../api/errors.js";
import type { ActivityEntry, MembershipRole } from "../api/types.js";
import { CollectionSkeleton, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { PageHeader, Panel, Section, Toolbar, ToolbarSpacer } from "../components/ui/Layout.js";
import { DataTable, CellSecondary, type DataTableColumn } from "../components/ui/DataTable.js";
import { Button } from "../components/ui/Button.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { TextField } from "../components/forms/TextField.js";
import "./ActivityLog.css";

/** ADMIN/OWNER only - mirrors the backend's ADMIN_ROLES tier for `activity:read`
 * (authorization.ts). */
function canViewActivity(role: MembershipRole | undefined): boolean {
  return role === "ADMIN" || role === "OWNER";
}

function actorLabel(entry: ActivityEntry): string {
  if (entry.actor.type === "SYSTEM") return "O sistema";
  // The real event contract requires `userId` on every USER actor, even after the account is
  // later removed (confirmed against the backend's own event type) - a missing value here can
  // only come from malformed/legacy data, never a genuine "account was removed" signal. Never
  // claim a specific cause the data can't prove.
  return entry.actor.userId ?? "Usuário não identificado";
}

/** `entry.action` is a free-form verb (`CREATE_ITEM`, `ROLE_CHANGED`, `SEND`, `RECONCILE_
 * UNKNOWN`…, confirmed against every real `action:` literal in `src/modules/**`) - there is no
 * closed CREATE/UPDATE/DELETE enum this domain actually emits, so a tone is only ever assigned
 * from a prefix/substring match that genuinely signals create/update/delete-like semantics;
 * everything else stays neutral rather than guessing a color the verb doesn't support (same
 * "never a stronger claim than the data proves" discipline as `StatusBadge.tsx`'s own header
 * comment - this is a local, scoped-to-this-screen heuristic, deliberately not routed through
 * `StatusBadge`/`presentation.ts`'s domain-state tone system, which is a different claim
 * entirely). */
function actionTone(action: string): "success" | "info" | "critical" | "neutral" {
  if (action.startsWith("CREATE") || action === "SEND" || action === "PROMOTE") return "success";
  if (action.startsWith("DELETE") || action.includes("REMOVE") || action.includes("REVOKE") || action.includes("REJECT")) return "critical";
  if (action.startsWith("UPDATE") || action.includes("CHANGE") || action.includes("ROLE_CHANGED") || action.startsWith("RENEW") || action.startsWith("ASSIGN") || action.startsWith("LINK") || action.startsWith("UNLINK")) return "info";
  return "neutral";
}

function ActionBadge({ action }: { action: string }) {
  return (
    <code className={`activity-action activity-action--${actionTone(action)}`} title={action}>
      {action}
    </code>
  );
}

function ActorCell({ entry }: { entry: ActivityEntry }) {
  const Icon = entry.actor.type === "SYSTEM" ? Cog : User;
  return (
    <div className="activity-actor">
      <span className={`activity-actor__avatar activity-actor__avatar--${entry.actor.type === "SYSTEM" ? "system" : "user"}`} aria-hidden="true">
        <Icon size={16} strokeWidth={2} />
      </span>
      {actorLabel(entry)}
    </div>
  );
}

function ResourceCell({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="activity-resource">
      <span className="activity-resource__icon" aria-hidden="true">
        <FileText size={15} strokeWidth={2} />
      </span>
      <div>
        <div>{entry.resourceType}</div>
        {entry.resourceId ? <CellSecondary>{entry.resourceId}</CellSecondary> : null}
      </div>
    </div>
  );
}

export function ActivityLog() {
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
  const [draftMonth, setDraftMonth] = useState("");
  const [draftResourceType, setDraftResourceType] = useState("");
  const [draftResourceId, setDraftResourceId] = useState(seededResourceId);
  const [month, setMonth] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [resourceId, setResourceId] = useState(seededResourceId);
  const [announcement, setAnnouncement] = useState("");
  const previousPageCount = useRef(0);
  const exhaustedTextRef = useRef<HTMLParagraphElement>(null);
  const wasExhausted = useRef(false);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMonth(draftMonth);
    setResourceType(draftResourceType);
    setResourceId(draftResourceId);
  }

  function clearFilters() {
    setDraftMonth("");
    setDraftResourceType("");
    setDraftResourceId("");
    setMonth("");
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

  const header = <PageHeader title="Log de atividade" description="Quem fez o quê, quando — em toda a organização." />;

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
    { key: "actor", header: "Ator", primary: true, render: (e) => <ActorCell entry={e} /> },
    { key: "action", header: "Ação", render: (e) => <ActionBadge action={e.action} /> },
    { key: "resource", header: "Recurso", render: (e) => <ResourceCell entry={e} /> },
    { key: "occurredAt", header: "Quando", numeric: true, render: (e) => new Date(e.occurredAt).toLocaleString("pt-BR") },
  ];

  return (
    <>
      {header}
      <Section heading="Filtros" headingId="activity-filters" icon={Filter}>
        <Panel padded>
          <form className="ui-form" onSubmit={applyFilters}>
            <div className="activity-filters__grid">
              <TextField id="activity-filter-month" label="Mês" type="month" value={draftMonth} onChange={setDraftMonth} hint="Vazio usa o mês atual." />
              <TextField id="activity-filter-resource-type" label="Tipo de recurso" value={draftResourceType} onChange={setDraftResourceType} hint="Ex.: ExpirationItem. Vazio mostra todos." />
              <TextField
                id="activity-filter-resource-id"
                label="Recurso (ID)"
                value={draftResourceId}
                onChange={setDraftResourceId}
                hint="Ex.: o ID de um vencimento específico. Vazio mostra todos."
              />
            </div>
            <div className="ui-form__actions">
              <Button type="submit" variant="primary" icon={Search}>
                Aplicar filtros
              </Button>
              <Button type="button" variant="secondary" icon={RotateCcw} onClick={clearFilters}>
                Limpar
              </Button>
            </div>
          </form>
        </Panel>
      </Section>
      <Section heading="Eventos" headingId="activity-events" annotation={`(${entries.length})`}>
        <Panel>
          <Toolbar>
            <ToolbarSpacer />
            <Button variant="tertiary" size="sm" icon={RefreshCw} onClick={() => void query.refetch()} pending={query.isRefetching}>
              {query.isRefetching ? "Atualizando…" : "Atualizar"}
            </Button>
          </Toolbar>
          {entries.length === 0 ? (
            <EmptyState kind="true-empty" message="Nenhum evento registrado ainda." />
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
