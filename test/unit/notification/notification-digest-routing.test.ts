import { describe, expect, it } from "vitest";
import { decideDigestRouting } from "../../../src/modules/notification/application/notification-digest-routing.js";

const NOW = "2026-09-27T12:00:00.000Z";

describe("decideDigestRouting (D-347 §3.5)", () => {
  it("bypasses EMAIL unconditionally - only WHATSAPP is ever digestible", () => {
    expect(decideDigestRouting({ channel: "EMAIL", targetKind: "ASSIGNEE", itemDueDate: "2027-01-01", now: NOW })).toBe("BYPASS_IMMEDIATE");
  });

  it("bypasses a MANAGER-audience (escalation) intent even when the item is not yet overdue", () => {
    expect(decideDigestRouting({ channel: "WHATSAPP", targetKind: "MANAGER", itemDueDate: "2027-01-01", now: NOW })).toBe("BYPASS_IMMEDIATE");
  });

  it("bypasses an overdue (VENCIDO) item regardless of audience", () => {
    expect(decideDigestRouting({ channel: "WHATSAPP", targetKind: "ASSIGNEE", itemDueDate: "2026-01-01", now: NOW })).toBe("BYPASS_IMMEDIATE");
  });

  it("digests a WHATSAPP ASSIGNEE reminder for an item not yet due", () => {
    expect(decideDigestRouting({ channel: "WHATSAPP", targetKind: "ASSIGNEE", itemDueDate: "2027-01-01", now: NOW })).toBe("DIGEST");
  });

  it("digests a WHATSAPP WATCHER reminder for an item within the VENCENDO window", () => {
    expect(decideDigestRouting({ channel: "WHATSAPP", targetKind: "WATCHER", itemDueDate: "2026-09-30", now: NOW })).toBe("DIGEST");
  });

  it("treats an intent with no targetKind (legacy ASSIGNEE default) as digestible when not overdue", () => {
    expect(decideDigestRouting({ channel: "WHATSAPP", targetKind: undefined, itemDueDate: "2027-01-01", now: NOW })).toBe("DIGEST");
  });
});
