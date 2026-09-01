/**
 * ActivityLog (D-149, admin-activity-log-scoping/estado-final-consolidado.md) - minimal
 * read-only admin activity/audit feed. ADMIN/OWNER only, same tier as GET /activity's
 * `activity:read` RBAC action - gated the same way Members.tsx gates its manage UI
 * (useCurrentMembershipRole + a local predicate), which is convenience/UX only: the backend
 * independently re-checks via authorize() on every request regardless of what this screen
 * shows or hides.
 *
 * Each event renders as one short prose line (actor + action + object + timestamp) - never
 * raw JSON (decisão 8). Month filter (yyyyMM, v1 has no cross-month pagination - decisão 2)
 * and resource-type filter are both applied server-side; pagination is a "Carregar mais"
 * button driven by the opaque cursor TanStack Query's useInfiniteQuery already tracks.
 */
import { useState } from "react";
import { useActivity } from "../hooks/useActivity.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { ApiError } from "../api/errors.js";
import type { ActivityEntry, MembershipRole } from "../api/types.js";
import { CollectionSkeleton, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";

/** ADMIN/OWNER only - mirrors the backend's ADMIN_ROLES tier for `activity:read`
 * (authorization.ts). */
function canViewActivity(role: MembershipRole | undefined): boolean {
  return role === "ADMIN" || role === "OWNER";
}

function actorLabel(entry: ActivityEntry): string {
  if (entry.actor.type === "SYSTEM") return "O sistema";
  return entry.actor.userId ? `Usuário ${entry.actor.userId}` : "Um usuário";
}

/** One short prose line per event - never the raw `changes` object (decisão 8). */
function ActivityLine({ entry }: { entry: ActivityEntry }) {
  const when = new Date(entry.occurredAt).toLocaleString("pt-BR");
  const object = entry.resourceId ? `${entry.resourceType} ${entry.resourceId}` : entry.resourceType;
  return (
    <li className="activity-log__entry">
      {actorLabel(entry)} executou {entry.action} em {object} — {when}
    </li>
  );
}

export function ActivityLog() {
  const role = useCurrentMembershipRole();
  const [month, setMonth] = useState("");
  const [resourceType, setResourceType] = useState("");

  const monthFilter = /^\d{6}$/.test(month) ? month : undefined;
  const resourceTypeFilter = resourceType.trim() || undefined;

  const query = useActivity({ month: monthFilter, resourceType: resourceTypeFilter, enabled: canViewActivity(role) });

  const header = <PageHeader title="Atividade" description="Trilha de auditoria administrativa desta organização." />;

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

  if (query.isError) {
    const message = query.error instanceof ApiError ? query.error.message : "Não foi possível carregar a atividade.";
    return (
      <>
        {header}
        <ErrorState message={message} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const entries = query.data.pages.flatMap((page) => page.entries);

  return (
    <>
      {header}
      <Section heading="Filtros" headingId="activity-filters">
        <Panel>
          <TextField label="Mês (AAAAMM)" value={month} onChange={setMonth} hint="Ex.: 202609. Vazio usa o mês atual." />
          <TextField label="Tipo de recurso" value={resourceType} onChange={setResourceType} hint="Ex.: ExpirationItem. Vazio mostra todos." />
        </Panel>
      </Section>
      <Panel>
        {entries.length === 0 ? (
          <EmptyState kind="true-empty" message="Nenhum evento de atividade encontrado." />
        ) : (
          <ul className="activity-log__list">
            {entries.map((entry) => (
              <ActivityLine key={entry.auditEventId} entry={entry} />
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <Button variant="tertiary" onClick={() => void query.fetchNextPage()} pending={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </Button>
        ) : null}
      </Panel>
    </>
  );
}
