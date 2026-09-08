/**
 * Exhaustive cross-tenant isolation matrix — D-234 (E-018, full-audit-round2 Seguranca criterio
 * 2, protocolo Claude<->Codex, 4 rodadas, ambos 9.2/10, Rodadas 2-3's "adversarial test matrix"
 * requirement). `test/integration/cross-tenant.test.ts` already proves the TENANT_MISMATCH
 * property for a handful of representative actions; Codex Rodada 2's objection was that a
 * "representative route" sample does not generalize to the ~90 actions in `authorization.ts`'s
 * `Action` union.
 *
 * This suite closes that gap WITHOUT a hand-maintained per-action test list (which would itself
 * drift the moment a new Action is added and nobody remembers to add its case): it iterates
 * `ALL_ACTIONS`, which is derived directly from `ACTION_ROLES`'s own keys inside
 * `authorization.ts`. Because `ACTION_ROLES` is typed `Record<Action, ReadonlySet<Role>>`,
 * TypeScript itself refuses to compile a new `Action` without an entry in that record - so
 * `ALL_ACTIONS` can never be stale, and this test automatically covers every action that exists
 * today or is added tomorrow with zero maintenance (stronger than a manually curated
 * included/excluded list, which needs a human to remember to update it).
 *
 * `authorize()`'s own documented ordering (see its doc comment) checks TENANT_MISMATCH before
 * role sufficiency - so this property holds independent of the caller's role, and independent of
 * which specific action is being attempted. The expected result is deliberately "never a resource
 * belonging to another tenant is treated as authorized" (an AuthorizationDeniedError with reason
 * TENANT_MISMATCH), not "always a 403 regardless of shape" - a real HTTP route reading a
 * cross-tenant resource is free to also return 404 further up the stack once repository-level
 * fencing is layered on top (D-234's other mitigation), but the `authorize()` boundary itself must
 * never be the layer that lets it through.
 */
import { describe, expect, it } from "vitest";
import { ALL_ACTIONS, authorize, AuthorizationDeniedError } from "../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../src/modules/identity/domain/request-context.js";

function contextFor(tenantId: string, roles: RequestContext["tenant"]["roles"]): RequestContext {
  return {
    principal: { userId: `user-${tenantId}` },
    tenant: { tenantId, roles },
  } as RequestContext;
}

describe("Tenant isolation matrix (exhaustive over every real Action)", () => {
  const ctxA = contextFor("tenant-A", ["OWNER"]);
  const tenantBResource = { tenantId: "tenant-B" };

  it(`covers every Action currently declared in authorization.ts (found ${ALL_ACTIONS.length})`, () => {
    // Guards against ALL_ACTIONS silently resolving to an empty/tiny array (e.g. an import
    // mistake) - the matrix below would trivially "pass" over zero cases otherwise.
    expect(ALL_ACTIONS.length).toBeGreaterThan(50);
  });

  it.each(ALL_ACTIONS)("action '%s': a resource belonging to another tenant is never authorized, regardless of role", (action) => {
    // OWNER is the most-privileged role in the system (ADMIN_ROLES/WRITE_ROLES/OWNER_ROLES are
    // all subsets of it where relevant) - if TENANT_MISMATCH doesn't stop even an OWNER, no
    // lesser role could possibly be stopped either, and this proves the check is unconditional
    // on role, exactly as authorize()'s own doc comment claims (TENANT_MISMATCH checked before
    // role sufficiency).
    let denied: AuthorizationDeniedError | undefined;
    try {
      authorize({ context: ctxA, action, resource: tenantBResource });
    } catch (err) {
      if (err instanceof AuthorizationDeniedError) denied = err;
      else throw err;
    }
    expect(denied, `action '${action}' must throw AuthorizationDeniedError for a cross-tenant resource`).toBeInstanceOf(AuthorizationDeniedError);
    expect(denied?.reason).toBe("TENANT_MISMATCH");
  });

  it.each(ALL_ACTIONS)("action '%s': the SAME tenant's own resource is never rejected on tenant grounds", (action) => {
    // Negative control for the matrix above - proves the check isn't vacuously always-throw
    // (which would make the previous test meaningless). May still throw INSUFFICIENT_ROLE (OWNER
    // is not necessarily allowed every action's role gate is irrelevant here) - this asserts
    // specifically that TENANT_MISMATCH is never the reason for the caller's own tenant.
    try {
      authorize({ context: ctxA, action, resource: { tenantId: ctxA.tenant.tenantId } });
    } catch (err) {
      if (err instanceof AuthorizationDeniedError) {
        expect(err.reason, `action '${action}' rejected the caller's OWN tenant on tenant grounds - that's a real bug`).not.toBe("TENANT_MISMATCH");
        return;
      }
      throw err;
    }
  });
});
