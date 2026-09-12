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
import { useEffect, useRef, useState } from "react";
import { useActivity } from "../hooks/useActivity.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { ApiError } from "../api/errors.js";
import type { ActivityEntry, MembershipRole } from "../api/types.js";
import { CollectionSkeleton, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { DataTable, type DataTableColumn } from "../components/ui/DataTable.js";
import { Button } from "../components/ui/Button.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { TextField } from "../components/forms/TextField.js";

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

function resourceLabel(entry: ActivityEntry): string {
  return entry.resourceId ? `${entry.resourceType} — ${entry.resourceId}` : entry.resourceType;
}

export function ActivityLog() {
  const role = useCurrentMembershipRole();
  const [month, setMonth] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const previousPageCount = useRef(0);
  const exhaustedTextRef = useRef<HTMLParagraphElement>(null);
  const wasExhausted = useRef(false);

  const monthFilter = /^\d{6}$/.test(month) ? month : undefined;
  const resourceTypeFilter = resourceType.trim() || undefined;

  const query = useActivity({ month: monthFilter, resourceType: resourceTypeFilter, enabled: canViewActivity(role) });

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
    { key: "actor", header: "Ator", primary: true, render: (e) => actorLabel(e) },
    { key: "action", header: "Ação", render: (e) => <code title={e.action}>{e.action}</code> },
    { key: "resource", header: "Recurso", render: (e) => <span title={resourceLabel(e)}>{resourceLabel(e)}</span> },
    { key: "occurredAt", header: "Quando", numeric: true, render: (e) => new Date(e.occurredAt).toLocaleString("pt-BR") },
  ];

  return (
    <>
      {header}
      <Section heading="Filtros" headingId="activity-filters">
        <Panel>
          <TextField label="Mês (AAAAMM)" value={month} onChange={setMonth} hint="Ex.: 202609. Vazio usa o mês atual." />
          <TextField label="Tipo de recurso" value={resourceType} onChange={setResourceType} hint="Ex.: ExpirationItem. Vazio mostra todos." />
        </Panel>
      </Section>
      <Section heading="Eventos" headingId="activity-events" annotation={`(${entries.length})`}>
        <Panel>
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
