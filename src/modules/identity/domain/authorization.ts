/**
 * Authorization matrix — implementation-blueprint.md §4.3. "A matriz é código
 * versionado e testado, não documentação informal."
 */
import type { RequestContext } from "./request-context.js";

export type Action =
  | "item:create"
  | "item:read"
  | "item:update"
  | "item:delete"
  | "item:watch"
  | "reminder:manage"
  | "document:reserve-upload"
  | "document:read"
  | "document:delete"
  | "extraction:confirm"
  | "notification:configure"
  | "audit:read"
  | "system:ping" // M1 test route action, not in the blueprint's business list but
  // declared explicitly here rather than silently bypassing the matrix (see report).
  // M9 (evolução estratégica do roadmap, D-036/D-039, 03-domain-model-tracked-subject-
  // requirement.md e 07-domain-model-escalation-watchers-digest.md): TrackedSubject +
  // RequirementAssignment + ItemWatch. Mesmo padrão resolver-deriva-tenantId de todo módulo
  // existente — nenhuma dessas actions confia em tenantId fornecido pelo cliente.
  | "subject:create"
  | "subject:read"
  | "subject:update"
  | "subject:delete"
  | "requirement:assign"
  | "requirement:read"
  | "requirement:update"
  | "requirement:delete"
  | "requirement:review"
  // M10 (guest upload/magic link, D-037, 04-domain-model-guest-upload.md): apenas o lado
  // autenticado do tenant tem action própria — o convidado nunca passa por authorize()/
  // RequestContext, é validado por GuestTokenService (fora da matriz de roles por design).
  | "requirement:request-document"
  // M10 cluster 4 (D-049): política de tenant para automatizar o convite inicial de guest
  // upload — decisão de comunicação externa/reputação de todo o tenant, não uma ação por
  // request individual (essa é `requirement:request-document` acima). B2B-7 (D-097/D-098):
  // OWNER_ROLES, não ADMIN_ROLES — a classe de "workspace settings"/comunicação externa que a
  // pesquisa de RBAC (research-protocol.md) mostrou ficar separada mesmo em produtos que dão
  // a ADMIN paridade de conteúdo com OWNER.
  | "tenant:configure-document-request-delivery"
  // M11 (CSV import/export, D-042, 09-domain-model-csv-import.md, cluster 7): superfície de
  // processamento em massa - mesma granularidade de document:reserve-upload/document:read.
  | "import:create"
  | "import:read"
  | "import:commit"
  // B2B-8 (D-099, docs/architecture/multi-user-b2b-wave-b2b8-scope.md): Invitations/Team.
  // Pesquisa (GitHub/Slack/Linear/Notion, 2026-08-30) convergiu em ADMIN-tier-e-acima gerencia
  // membros (nunca MEMBER/VIEWER), e só OWNER promove/demove o próprio tier OWNER (Slack:
  // "Owners can assign Owners... [and] assign Admins") — a segunda parte não é expressável na
  // matriz genérica (não há um "OWNER, exceto quando o alvo/novo role é OWNER"), fica como
  // checagem de serviço nomeada (OwnerTierChangeRequiresOwnerError) em cima do ADMIN_ROLES
  // baseline abaixo. `membership:leave` nunca aceita um alvo externo (LeaveOrganizationService
  // opera só sobre ctx.principal.userId por assinatura) - a proteção real é o LastOwnerError
  // transacional, não a matriz.
  | "membership:invite"
  | "membership:revoke-invitation"
  // Convites pendentes carregam e-mail + intenção de adicionar pessoa - superfície
  // administrativa (Linear "Settings > Administration > Members" para pending invites), nunca
  // a mesma tier de "listar membros ativos" (achado real da Rodada 1 do Codex).
  | "membership:list-invitations"
  | "membership:list-members"
  | "membership:role-change"
  | "membership:remove"
  | "membership:leave"
  // Wave B2B-10 (Tenant-aware Frontend): Organization.displayName/timezone. OWNER_ROLES, same
  // tier as "tenant:configure-document-request-delivery" above — workspace identity/settings
  // that reads externally (invitation emails, guest-facing name) is consistently kept OWNER-only
  // in this codebase, not paritary with ADMIN like most other membership-management actions.
  | "organization:update-settings"
  // D-123/D-126 (CSV data export): bulk export of ExpirationItem rows across the whole tenant.
  // ADMIN_ROLES, NOT a bulk-action precedent — the justification is disclosure asymmetry:
  // export READS every member's work (including items the caller never touched), while
  // import only WRITES what the actor could already create individually. See
  // docs/architecture/reviews/data-export-scoping/round-3-claude-proposal.md.
  | "item:export"
  // W3-07 purge orchestrator (D-124, implementing D-121): closing the organization starts the
  // physical, irreversible tenant purge (`ACTIVE -> DELETING -> ... -> DELETED`). OWNER_ROLES,
  // the same tier as `tenant:configure-document-request-delivery`/`organization:update-settings`
  // above — this is the single most destructive tenant-wide action in the system, so it can never
  // be paritary with ADMIN the way ordinary content administration is.
  | "organization:close"
  // D-143 (Document Archive domain, Nucleus 1): distinct namespace from the existing
  // `document:*` actions above, which belong to the low-level generic file-object storage
  // module (src/modules/document/ — S3/malware-scan primitives). `docarchive:*` is the
  // higher-level business domain (Document/DocumentVersion/state machine) — same tenant-wide
  // RBAC tiers as every other business resource, no per-item ACL (D-143 Decision 1/9 explicitly
  // rejected presuming an ACL `authorize()` doesn't implement). `docarchive:review` covers
  // claim/accept/reject — the finer-grained "may THIS actor decide THIS version" check is a
  // separate, named service-level gate (`assertReviewerOrAdmin`), not a distinct RBAC action.
  | "docarchive:create"
  | "docarchive:read"
  | "docarchive:upload"
  | "docarchive:review"
  // D-143 Nucleus 2, entity 1 (Decision 5, D-145): Requirement — "algo que um Subject precisa
  // possuir, apresentar ou manter válido". Deliberately NOT reusing `requirement:*` above:
  // those belong to the older, distinct `subject` module's `RequirementAssignment` concept
  // (linked ExpirationItem, MISSING<->SATISFIED only). This Requirement is document-archive's
  // own aggregate (linked DocumentVersion evidence, 5-state derived status) — a real naming
  // collision resolved deliberately by namespacing under `docarchive:`, same prefix as this
  // module's other actions, rather than overloading the older name silently.
  | "docarchive:requirement-create"
  | "docarchive:requirement-read"
  | "docarchive:requirement-update"
  | "docarchive:requirement-delete"
  // D-143 Nucleus 2, entity 3/3 (Decision 8, D-147): recurrence. Series management (create/
  // read/list/cancel, materializeAttempt) is a tenant-facing operation, same WRITE/READ_ONLY
  // tiers as Requirement above — no per-item ACL here either, same D-143 Decision 9 rationale.
  // `docarchive:series-materialize` is distinct from `-update` because it is invoked by the
  // periodic producer/materializer worker on the series' own schedule, not by a direct caller
  // edit — kept as its own action so a future service-role-scoped policy could grant it
  // separately from interactive series editing without reshaping the matrix again.
  | "docarchive:series-create"
  | "docarchive:series-read"
  | "docarchive:series-update"
  | "docarchive:series-cancel"
  | "docarchive:series-materialize";

export interface AuthorizedResource {
  tenantId: string;
  ownerUserId?: string;
  assigneeUserId?: string;
  status?: string;
}

export interface AuthorizationInput {
  context: RequestContext;
  action: Action;
  resource?: AuthorizedResource;
}

/**
 * Role model closed by Wave B2B-7 (RBAC, D-097/D-098) — `Membership.role` (D-090) has 4 real
 * values; this matrix now recognizes all of them. Research protocol E-014 applied for the
 * first time (docs/engineering/research-protocol.md): GitHub/Linear/Slack/Notion + NIST/ANSI
 * INCITS 359 (Hierarchical RBAC) don't converge on a single "what does Admin get beyond
 * Member" answer, so each action formerly gated to ADMIN_ROLES got a named, individual
 * decision instead of a blanket parity rule — see multi-user-b2b-wave-b2b7-scope.md.
 */
export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
const WRITE_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN"]);
/** Owner-exclusive tier (B2B-7) — reserved for actions with tenant-wide external/reputational
 * impact (research: the class GitHub/Linear/Slack/Notion keep apart from ordinary content
 * admin). Members: `tenant:configure-document-request-delivery` (B2B-7),
 * `organization:update-settings` (B2B-10), `organization:close` (W3-07/D-124). */
const OWNER_ROLES: ReadonlySet<Role> = new Set(["OWNER"]);

const ACTION_ROLES: Record<Action, ReadonlySet<Role>> = {
  "item:create": WRITE_ROLES,
  "item:read": READ_ONLY_ROLES,
  "item:update": WRITE_ROLES,
  "item:delete": ADMIN_ROLES,
  "item:export": ADMIN_ROLES,
  "item:watch": WRITE_ROLES,
  "reminder:manage": WRITE_ROLES,
  "document:reserve-upload": WRITE_ROLES,
  "document:read": READ_ONLY_ROLES,
  "document:delete": ADMIN_ROLES,
  "extraction:confirm": WRITE_ROLES,
  // B2B-7 bug fix (not an ADMIN-vs-OWNER call): this action gates both read and update of a
  // per-user preference (ctx.principal.userId-keyed, notification-preferences-service.ts),
  // never tenant-wide config. This is tied to the ability to RECEIVE a reminder -
  // assigneeUserId is never role-checked, so a VIEWER can legitimately be a notification
  // recipient and must be able to configure it for themself. Reuses READ_ONLY_ROLES (already
  // "any real Membership") rather than adding a 5th constant with the same 4 members.
  "notification:configure": READ_ONLY_ROLES,
  "audit:read": READ_ONLY_ROLES,
  "system:ping": READ_ONLY_ROLES,
  "subject:create": WRITE_ROLES,
  "subject:read": READ_ONLY_ROLES,
  "subject:update": WRITE_ROLES,
  "subject:delete": ADMIN_ROLES,
  "requirement:assign": WRITE_ROLES,
  "requirement:read": READ_ONLY_ROLES,
  "requirement:update": WRITE_ROLES,
  "requirement:delete": ADMIN_ROLES,
  "requirement:review": WRITE_ROLES,
  "requirement:request-document": WRITE_ROLES,
  "tenant:configure-document-request-delivery": OWNER_ROLES,
  "import:create": WRITE_ROLES,
  "import:read": READ_ONLY_ROLES,
  "import:commit": WRITE_ROLES,
  "membership:invite": ADMIN_ROLES,
  "membership:revoke-invitation": ADMIN_ROLES,
  "membership:list-invitations": ADMIN_ROLES,
  "membership:list-members": READ_ONLY_ROLES,
  "membership:role-change": ADMIN_ROLES,
  "membership:remove": ADMIN_ROLES,
  "membership:leave": READ_ONLY_ROLES,
  "organization:update-settings": OWNER_ROLES,
  "organization:close": OWNER_ROLES,
  "docarchive:create": WRITE_ROLES,
  "docarchive:read": READ_ONLY_ROLES,
  "docarchive:upload": WRITE_ROLES,
  "docarchive:review": WRITE_ROLES,
  "docarchive:requirement-create": WRITE_ROLES,
  "docarchive:requirement-read": READ_ONLY_ROLES,
  "docarchive:requirement-update": WRITE_ROLES,
  "docarchive:requirement-delete": WRITE_ROLES,
  "docarchive:series-create": WRITE_ROLES,
  "docarchive:series-read": READ_ONLY_ROLES,
  "docarchive:series-update": WRITE_ROLES,
  "docarchive:series-cancel": WRITE_ROLES,
  "docarchive:series-materialize": WRITE_ROLES,
};

export type AuthorizationDenialReason = "TENANT_MISMATCH" | "NO_MEMBERSHIP" | "INSUFFICIENT_ROLE" | "RESOURCE_OWNERSHIP_MISMATCH";

export class AuthorizationDeniedError extends Error {
  constructor(
    readonly reason: AuthorizationDenialReason,
    readonly action: Action,
  ) {
    super(`Authorization denied for action "${action}": ${reason}`);
    this.name = "AuthorizationDeniedError";
  }
}

/**
 * authorize() — implementation-blueprint.md §4.3: "authorize() verifica primeiro
 * igualdade de tenant, depois papel e vínculo por recurso." Throws
 * AuthorizationDeniedError (never returns false) so callers cannot forget to check
 * a boolean result — the http layer maps this to AuthorizationError (403).
 *
 * Order matters and is deliberately fail-closed at every step:
 *  1. context must carry at least one role (no membership => no access at all).
 *  2. if a resource is supplied, resource.tenantId MUST equal context.tenant.tenantId —
 *     this is the check that makes cross-tenant ID substitution fail, independent of
 *     role, and independent of what the caller *claims* the resource's tenant is (the
 *     resource object here must always be populated from a DB read keyed by the
 *     authenticated tenantId, never from client input — see repository contract).
 *  3. role must be sufficient for the action.
 *  4. if the resource declares an owner/assignee, membership role alone isn't enough
 *     for actions that are resource-scoped by ownership in the future; MVP has no
 *     per-item ownership finer than tenant, so this step is a no-op today but kept
 *     explicit so a future item-level ACL doesn't require re-deriving this function.
 */
export function authorize(input: AuthorizationInput): void {
  const { context, action, resource } = input;
  const roles = context.tenant.roles as Role[];

  if (roles.length === 0) {
    throw new AuthorizationDeniedError("NO_MEMBERSHIP", action);
  }

  if (resource && resource.tenantId !== context.tenant.tenantId) {
    throw new AuthorizationDeniedError("TENANT_MISMATCH", action);
  }

  const allowedRoles = ACTION_ROLES[action];
  const hasRole = roles.some((role) => allowedRoles.has(role));
  if (!hasRole) {
    throw new AuthorizationDeniedError("INSUFFICIENT_ROLE", action);
  }

  if (resource?.assigneeUserId && resource.ownerUserId) {
    const isOwnerOrAssignee =
      resource.ownerUserId === context.principal.userId ||
      resource.assigneeUserId === context.principal.userId;
    // OWNER and ADMIN bypass per-resource ownership (tenant-wide content admin, B2B-7 -
    // ADMIN has parity with OWNER over business resources, see authorization.ts role model
    // comment above), MEMBER/VIEWER scoped resources require ownership match once per-item
    // ACLs exist. This is enforced only when both fields ARE present (defensive for future
    // use), never invented from nothing.
    if (!roles.includes("OWNER") && !roles.includes("ADMIN") && !isOwnerOrAssignee) {
      throw new AuthorizationDeniedError("RESOURCE_OWNERSHIP_MISMATCH", action);
    }
  }
}
