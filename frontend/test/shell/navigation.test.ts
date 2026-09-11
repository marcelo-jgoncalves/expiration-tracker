import { describe, expect, it } from "vitest";
import { getVisibleNavItems, NAV_ITEMS } from "../../src/shell/navigation.js";

describe("getVisibleNavItems (D-2xx, Block 0 RBAC-aware nav)", () => {
  it("returns every item while the role has not resolved yet (undefined)", () => {
    expect(getVisibleNavItems(undefined)).toEqual(NAV_ITEMS);
  });

  it("shows Membros (roster is membership:list-members, READ_ONLY_ROLES) but hides Atividade for a VIEWER", () => {
    const ids = getVisibleNavItems("VIEWER").map((item) => item.id);
    expect(ids).toEqual(["overview", "items", "subjects", "requirements", "reviews", "members", "settings", "document-types", "requirement-templates"]);
  });

  // A15 (Block 9) - "Importar CSV" is WRITE_ROLES only (`import:create/map/commit`) - a MEMBER
  // sees it, a VIEWER (above) does not.
  it("shows Membros AND Importar CSV, but hides Atividade, for a MEMBER", () => {
    const ids = getVisibleNavItems("MEMBER").map((item) => item.id);
    expect(ids).toEqual(["overview", "items", "subjects", "requirements", "reviews", "imports", "members", "settings", "document-types", "requirement-templates"]);
  });

  it("shows every item for an ADMIN", () => {
    const ids = getVisibleNavItems("ADMIN").map((item) => item.id);
    expect(ids).toEqual(["overview", "items", "subjects", "requirements", "reviews", "imports", "members", "settings", "document-types", "requirement-templates", "activity"]);
  });

  it("shows every item for an OWNER, including the OWNER-exclusive 'request-delivery' (A22)", () => {
    const ids = getVisibleNavItems("OWNER").map((item) => item.id);
    expect(ids).toEqual([
      "overview",
      "items",
      "subjects",
      "requirements",
      "reviews",
      "imports",
      "members",
      "settings",
      "document-types",
      "requirement-templates",
      "request-delivery",
      "activity",
    ]);
  });

  // A15 (Block 9) - same discipline as A22's `request-delivery` above: a role with no write
  // action behind the nav entry never sees it at all.
  it("hides 'Importar CSV' from VIEWER only", () => {
    expect(getVisibleNavItems("VIEWER").map((item) => item.id)).not.toContain("imports");
    for (const role of ["MEMBER", "ADMIN", "OWNER"] as const) {
      expect(getVisibleNavItems(role).map((item) => item.id)).toContain("imports");
    }
  });

  // A22 (Block 7, D-267) - `tenant:configure-document-request-delivery` is OWNER_ROLES
  // EXCLUSIVE, stricter than "activity" (ADMIN/OWNER) above - no other role sees this entry.
  it("hides 'Entrega de solicitação' from every non-OWNER role", () => {
    for (const role of ["VIEWER", "MEMBER", "ADMIN"] as const) {
      expect(getVisibleNavItems(role).map((item) => item.id)).not.toContain("request-delivery");
    }
  });

  // A20 (Block 4, D-2xx) - `docarchive:documenttype-read` is READ_ONLY_ROLES: every real
  // Membership tier, including VIEWER, sees this nav entry (same discipline as "members"/
  // "requirements" above - mutation is gated inside the screen itself, never at nav level).
  it("shows Tipos de documento to every role, including VIEWER", () => {
    for (const role of ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const) {
      expect(getVisibleNavItems(role).map((item) => item.id)).toContain("document-types");
    }
  });

  // A21 (Block 4, D-2xx) - same discipline as A20 above: `docarchive:requirementtemplate-read`
  // is READ_ONLY_ROLES.
  it("shows Templates de requisitos to every role, including VIEWER", () => {
    for (const role of ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const) {
      expect(getVisibleNavItems(role).map((item) => item.id)).toContain("requirement-templates");
    }
  });

  // A13 (Block 5, D-2xx) - `docarchive:read` is READ_ONLY_ROLES: every real Membership tier,
  // including VIEWER, sees the "Revisões" nav entry (Reivindicar/Aceitar/Rejeitar are gated
  // inside the screen itself, never at nav level).
  it("shows Revisões to every role, including VIEWER", () => {
    for (const role of ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const) {
      expect(getVisibleNavItems(role).map((item) => item.id)).toContain("reviews");
    }
  });
});
