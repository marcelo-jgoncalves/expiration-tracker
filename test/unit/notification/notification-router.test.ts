import { describe, expect, it } from "vitest";
import { decideRouting, type RouterInput } from "../../../src/modules/notification/application/notification-router.js";

function baseInput(overrides: Partial<RouterInput> = {}): RouterInput {
  return {
    intent: { itemVersion: 3, policyVersion: 2, requestedChannels: ["EMAIL"] },
    item: { version: 3, status: "ACTIVE" },
    policy: { version: 2, enabled: true, requiresCommunication: true },
    recipient: { resolved: { userId: "u1", active: true }, candidateWasEmpty: false },
    entitlement: { emailEnabled: true },
    preference: { emailEnabled: true, quietHours: undefined },
    now: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("NotificationRouter.decideRouting", () => {
  it("routes EMAIL when every check passes", () => {
    const result = decideRouting(baseInput());
    expect(result).toEqual({ kind: "ROUTED", routedChannels: ["EMAIL"], cancelledChannels: [], deliverNotBefore: undefined });
  });

  it("item inactive -> CANCELLED_ALL ITEM_INACTIVE", () => {
    const result = decideRouting(baseInput({ item: { version: 3, status: "ARCHIVED" } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "ITEM_INACTIVE" });
  });

  it("item version stale with no prior attempt -> STALE REPLACEMENT", () => {
    const result = decideRouting(baseInput({ item: { version: 4, status: "ACTIVE" } }));
    expect(result).toEqual({ kind: "STALE", correctiveKind: "REPLACEMENT" });
  });

  it("item version stale with a SUBMITTING prior attempt -> STALE CORRECTIVE (delivery may have crossed the external limit)", () => {
    const result = decideRouting(baseInput({ item: { version: 4, status: "ACTIVE" }, latestAttemptStatus: "SUBMITTING" }));
    expect(result).toEqual({ kind: "STALE", correctiveKind: "CORRECTIVE" });
  });

  it("policy disabled -> CANCELLED_ALL POLICY_DISABLED", () => {
    const result = decideRouting(baseInput({ policy: { version: 2, enabled: false, requiresCommunication: true } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "POLICY_DISABLED" });
  });

  it("policy version changed but no longer requires communication -> CANCELLED_ALL POLICY_VERSION_CHANGED", () => {
    const result = decideRouting(baseInput({ policy: { version: 5, enabled: true, requiresCommunication: false } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "POLICY_VERSION_CHANGED" });
  });

  it("policy version changed and still requires communication -> STALE", () => {
    const result = decideRouting(baseInput({ policy: { version: 5, enabled: true, requiresCommunication: true } }));
    expect(result).toEqual({ kind: "STALE", correctiveKind: "REPLACEMENT" });
  });

  it("empty recipient candidate -> CANCELLED_ALL RECIPIENT_NOT_FOUND", () => {
    const result = decideRouting(baseInput({ recipient: { resolved: undefined, candidateWasEmpty: true } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "RECIPIENT_NOT_FOUND" });
  });

  it("cross-tenant / invalid assigneeUserId (resolver returns undefined, never a silent fallback) -> CANCELLED_ALL RECIPIENT_NOT_FOUND, no e-mail queued", () => {
    const result = decideRouting(baseInput({ recipient: { resolved: undefined, candidateWasEmpty: false } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "RECIPIENT_NOT_FOUND" });
  });

  it("recipient resolved but inactive -> CANCELLED_ALL RECIPIENT_NOT_ELIGIBLE", () => {
    const result = decideRouting(baseInput({ recipient: { resolved: { userId: "u1", active: false }, candidateWasEmpty: false } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "RECIPIENT_NOT_ELIGIBLE" });
  });

  it("entitlement storage unavailable -> RETRY (fail-closed WITH retry, not silent cancellation)", () => {
    const result = decideRouting(baseInput({ entitlement: { emailEnabled: undefined } }));
    expect(result).toEqual({ kind: "RETRY", cause: "ENTITLEMENT_UNAVAILABLE" });
  });

  it("entitlement denies e-mail -> CANCELLED_ALL NOT_ENTITLED", () => {
    const result = decideRouting(baseInput({ entitlement: { emailEnabled: false } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "NOT_ENTITLED" });
  });

  it("preference record missing/unavailable -> RETRY (technical gap, never interpreted as opt-in or opt-out)", () => {
    const result = decideRouting(baseInput({ preference: { emailEnabled: undefined, quietHours: undefined } }));
    expect(result).toEqual({ kind: "RETRY", cause: "PREFERENCE_UNAVAILABLE" });
  });

  it("preference opted out -> CANCELLED_ALL OPTED_OUT", () => {
    const result = decideRouting(baseInput({ preference: { emailEnabled: false, quietHours: undefined } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "OPTED_OUT" });
  });

  it("requested channel not supported (WHATSAPP) alongside EMAIL -> EMAIL routed, WHATSAPP cancelled individually", () => {
    const result = decideRouting(baseInput({ intent: { itemVersion: 3, policyVersion: 2, requestedChannels: ["EMAIL", "WHATSAPP"] } }));
    expect(result).toEqual({
      kind: "ROUTED",
      routedChannels: ["EMAIL"],
      cancelledChannels: [{ channel: "WHATSAPP", reason: "CHANNEL_UNAVAILABLE" }],
      deliverNotBefore: undefined,
    });
  });

  it("only WHATSAPP requested -> CANCELLED_ALL CHANNEL_UNAVAILABLE", () => {
    const result = decideRouting(baseInput({ intent: { itemVersion: 3, policyVersion: 2, requestedChannels: ["WHATSAPP"] } }));
    expect(result).toEqual({ kind: "CANCELLED_ALL", reason: "CHANNEL_UNAVAILABLE" });
  });

  it("quiet hours active -> ROUTED with deliverNotBefore set, never cancelled", () => {
    const result = decideRouting(
      baseInput({
        preference: {
          emailEnabled: true,
          quietHours: { enabled: true, startLocal: "22:00", endLocal: "07:00", timeZone: "America/Sao_Paulo" },
        },
        now: "2026-09-10T02:00:00.000Z", // 23:00 local (UTC-3), inside the 22:00-07:00 window
      }),
    );
    expect(result.kind).toBe("ROUTED");
    if (result.kind === "ROUTED") {
      expect(result.deliverNotBefore).toBeDefined();
    }
  });
});
