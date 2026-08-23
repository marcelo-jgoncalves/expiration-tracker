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
  // request individual (essa é `requirement:request-document` acima) - ADMIN_ROLES, nunca
  // WRITE_ROLES.
  | "tenant:configure-document-request-delivery"
  // M11 (CSV import/export, D-042, 09-domain-model-csv-import.md, cluster 7): superfície de
  // processamento em massa - mesma granularidade de document:reserve-upload/document:read.
  | "import:create"
  | "import:read"
  | "import:commit";

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
 * Minimal role model for M1 (MVP: tenantId=userId, single-owner tenants). Membership/roles
 * beyond OWNER are FUT-001 (Organization/Membership) per data-model.md — the matrix is
 * structured so adding roles later doesn't change call sites, only this table.
 */
export type Role = "OWNER" | "MEMBER" | "VIEWER";

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set(["OWNER", "MEMBER", "VIEWER"]);
const WRITE_ROLES: ReadonlySet<Role> = new Set(["OWNER", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<Role> = new Set(["OWNER"]);

const ACTION_ROLES: Record<Action, ReadonlySet<Role>> = {
  "item:create": WRITE_ROLES,
  "item:read": READ_ONLY_ROLES,
  "item:update": WRITE_ROLES,
  "item:delete": ADMIN_ROLES,
  "item:watch": WRITE_ROLES,
  "reminder:manage": WRITE_ROLES,
  "document:reserve-upload": WRITE_ROLES,
  "document:read": READ_ONLY_ROLES,
  "document:delete": ADMIN_ROLES,
  "extraction:confirm": WRITE_ROLES,
  "notification:configure": ADMIN_ROLES,
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
  "tenant:configure-document-request-delivery": ADMIN_ROLES,
  "import:create": WRITE_ROLES,
  "import:read": READ_ONLY_ROLES,
  "import:commit": WRITE_ROLES,
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
    // OWNER role bypasses per-resource ownership (tenant-wide admin), MEMBER/VIEWER
    // scoped resources would require ownership match once per-item ACLs exist. MVP:
    // tenant-wide access for any authenticated member is the approved model (single
    // owner per tenant today), so this is enforced only when both fields ARE present
    // (defensive for future use), never invented from nothing.
    if (!roles.includes("OWNER") && !isOwnerOrAssignee) {
      throw new AuthorizationDeniedError("RESOURCE_OWNERSHIP_MISMATCH", action);
    }
  }
}
