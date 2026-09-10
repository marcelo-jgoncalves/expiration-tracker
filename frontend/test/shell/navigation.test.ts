import { describe, expect, it } from "vitest";
import { getVisibleNavItems, NAV_ITEMS } from "../../src/shell/navigation.js";

describe("getVisibleNavItems (D-2xx, Block 0 RBAC-aware nav)", () => {
  it("returns every item while the role has not resolved yet (undefined)", () => {
    expect(getVisibleNavItems(undefined)).toEqual(NAV_ITEMS);
  });

  it("shows Membros (roster is membership:list-members, READ_ONLY_ROLES) but hides Atividade for a VIEWER", () => {
    const ids = getVisibleNavItems("VIEWER").map((item) => item.id);
    expect(ids).toEqual(["overview", "items", "subjects", "requirements", "members", "settings"]);
  });

  it("shows Membros but hides Atividade for a MEMBER", () => {
    const ids = getVisibleNavItems("MEMBER").map((item) => item.id);
    expect(ids).toEqual(["overview", "items", "subjects", "requirements", "members", "settings"]);
  });

  it("shows every item for an ADMIN", () => {
    const ids = getVisibleNavItems("ADMIN").map((item) => item.id);
    expect(ids).toEqual(["overview", "items", "subjects", "requirements", "members", "settings", "activity"]);
  });

  it("shows every item for an OWNER", () => {
    const ids = getVisibleNavItems("OWNER").map((item) => item.id);
    expect(ids).toEqual(["overview", "items", "subjects", "requirements", "members", "settings", "activity"]);
  });
});
