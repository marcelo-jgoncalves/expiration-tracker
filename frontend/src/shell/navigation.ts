/**
 * Declarative AppShell navigation (D-2xx, Block 0 - implementation-sequencing-plan.md,
 * p0-screen-inventory-plan.md §2.1's RBAC-aware navigation rule).
 *
 * Two things this file exists to fix, both flagged by the screen-spec audit
 * (system-level-findings.md SLF-03, process half covered by the route migration; this is the
 * structural half): AppShell.tsx previously hardcoded `<NavLink>` JSX per item with no way to
 * ask "what should this role see" without re-reading component markup, and there was no single
 * place a later block (A11 Requisitos, A13 Revisões, A16 Relatórios - the remaining items of the
 * prototype's 7-item target nav, `docs/frontend/prototype-screen-specs/README.md` "Navegação
 * global (AppShell)") can register a new entry without touching AppShell's render logic.
 *
 * Scope note: only today's 6 REAL routes are listed - Requisitos/Revisões/Relatórios are not
 * wired here yet because their screens (A11/A13/A16) do not exist in this codebase yet (adding a
 * nav entry with nowhere real to land would be a dead link, not progress). Recorded as pending
 * in NEXT_SESSION_PROMPT.md / decisions-log.md - append to NAV_ITEMS when each of those blocks
 * ships, nothing else about AppShell needs to change.
 *
 * RBAC is "hide, never just disable" (p0-screen-inventory-plan.md §2.1): an item whose
 * `allowedRoles` excludes the current role is omitted from the list entirely, mirroring the
 * codebase's established convention for gating a whole PAGE by role (Members.tsx/ActivityLog.tsx's
 * `canManageMembers`/`canViewActivity`, both ADMIN/OWNER-only) - this file is the nav-level
 * expression of the exact same tiers, never a third, competing definition of who can do what.
 * `allowedRoles: undefined` means every role (OWNER/ADMIN/MEMBER/VIEWER) can see the item.
 */
import type { MembershipRole } from "../api/types.js";

export interface NavItem {
  /** Stable id, also used as the React key - independent of `label` so a copy change never
   * silently changes identity. */
  id: string;
  to: string;
  label: string;
  /** `undefined` = visible to every role. Otherwise the exact allow-list of roles that see this
   * item at all. */
  allowedRoles?: readonly MembershipRole[];
}

const ADMIN_ROLES: readonly MembershipRole[] = ["ADMIN", "OWNER"];
const OWNER_ROLES: readonly MembershipRole[] = ["OWNER"];

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", to: "/overview", label: "Visão geral" },
  { id: "items", to: "/items", label: "Vencimentos" },
  { id: "subjects", to: "/subjects", label: "Fornecedores" },
  // A11 (Block 3, D-2xx) - `docarchive:requirement-read` is READ_ONLY_ROLES, every role sees
  // this list (create/edit/delete are individually gated inside the screen itself).
  { id: "requirements", to: "/requirements", label: "Requisitos" },
  // A13 (Block 5, D-2xx) - `docarchive:read` is READ_ONLY_ROLES, every role sees the queue
  // (Reivindicar/Aceitar/Rejeitar are individually gated inside the screen, same discipline as
  // "requirements" above).
  { id: "reviews", to: "/reviews", label: "Revisões" },
  // Visible to every role, deliberately NOT ADMIN-gated (fixed after the Block 0 Codex review
  // round caught this as a real RBAC-nav bug in the first draft): the backend action the roster
  // GET actually authorizes against is `membership:list-members`, which is READ_ONLY_ROLES - every
  // real Membership tier, including VIEWER (`src/modules/identity/domain/authorization.ts:309`,
  // `p0-screen-inventory-plan.md` A19 entry: "every role sees the roster"). Only INVITE/MANAGE
  // actions (`membership:invite`/`membership:role-change`/...) are ADMIN_ROLES-gated, and those
  // live inside the Members screen itself (Members.tsx's own `canManageMembers`), never at the
  // nav-visibility level - hiding the whole nav entry for a role that can legitimately view the
  // roster would be an access REDUCTION the real RBAC matrix never asked for.
  { id: "members", to: "/members", label: "Membros" },
  { id: "settings", to: "/settings", label: "Configurações" },
  // A20 (Block 4, D-2xx) - `docarchive:documenttype-read` is READ_ONLY_ROLES, every role
  // browses the catalog (mutation is individually gated inside the screen, same discipline as
  // "requirements" above).
  { id: "document-types", to: "/settings/document-types", label: "Tipos de documento" },
  // A21 (Block 4, D-2xx) - `docarchive:requirementtemplate-read` is READ_ONLY_ROLES, every role
  // browses (apply/administer are individually gated inside the screen itself).
  { id: "requirement-templates", to: "/settings/requirement-templates", label: "Templates de requisitos" },
  // A22 (Block 7, D-267) - `tenant:configure-document-request-delivery` is OWNER_ROLES
  // EXCLUSIVE (`authorization.ts:307`), stricter than the ADMIN_ROLES tier below - no other
  // role sees this entry at all, matching the spec's explicit "totalmente ausentes" instruction.
  { id: "request-delivery", to: "/settings/request-delivery", label: "Entrega de solicitação", allowedRoles: OWNER_ROLES },
  // ADMIN/OWNER only - matches ActivityLog.tsx's own `canViewActivity` tier (`activity:read`,
  // ADMIN_ROLES in `authorization.ts:330`) - unlike Membros above, there is no READ_ONLY_ROLES
  // action backing this screen for any other role, so hiding it here is correct, not a bug.
  { id: "activity", to: "/activity", label: "Atividade", allowedRoles: ADMIN_ROLES },
  // A16 (Block 10, D-2xx) - `item:export`/`docarchive:requirement-export`/
  // `reports:subscription-manage` are all ADMIN_ROLES exclusively (authorization.ts) - no
  // READ_ONLY_ROLES exception exists for this screen, unlike "members"/"requirements" above.
  { id: "reports", to: "/reports", label: "Relatórios", allowedRoles: ADMIN_ROLES },
];

/**
 * `role: undefined` (session/role query still pending) returns every item - mirrors
 * ActivityLog.tsx's own `role !== undefined && !canViewActivity(role)` convention of treating
 * "not resolved yet" as "don't block" rather than flashing a hidden-then-shown nav on every
 * load. Once `role` resolves, items outside its `allowedRoles` are dropped for good (until the
 * role itself changes, e.g. a live demotion reflected on the next session refetch).
 */
export function getVisibleNavItems(role: MembershipRole | undefined): readonly NavItem[] {
  if (role === undefined) return NAV_ITEMS;
  return NAV_ITEMS.filter((item) => !item.allowedRoles || item.allowedRoles.includes(role));
}
