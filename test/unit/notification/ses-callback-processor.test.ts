import { describe, expect, it } from "vitest";
import { decideCallbackApplication, complaintRequiresSuppression } from "../../../src/modules/notification/application/ses-callback-processor.js";

describe("decideCallbackApplication - monotonic precedence (COMPLAINED > BOUNCED > DELIVERED > ACCEPTED > SUBMITTING)", () => {
  it("ACCEPTED -> DELIVERY callback applies, becomes DELIVERED", () => {
    expect(decideCallbackApplication("ACCEPTED", "DELIVERY")).toEqual({ apply: true, nextStatus: "DELIVERED" });
  });

  it("ACCEPTED -> BOUNCE callback applies (bounce can arrive after acceptance)", () => {
    expect(decideCallbackApplication("ACCEPTED", "BOUNCE")).toEqual({ apply: true, nextStatus: "BOUNCED" });
  });

  it("DELIVERED -> BOUNCE callback still applies (bounce can arrive after delivery notification)", () => {
    expect(decideCallbackApplication("DELIVERED", "BOUNCE")).toEqual({ apply: true, nextStatus: "BOUNCED" });
  });

  it("DELIVERED -> COMPLAINT callback applies", () => {
    expect(decideCallbackApplication("DELIVERED", "COMPLAINT")).toEqual({ apply: true, nextStatus: "COMPLAINED" });
  });

  it("never regresses DELIVERED -> ACCEPTED (duplicate DELIVERY callback is a no-op)", () => {
    expect(decideCallbackApplication("DELIVERED", "DELIVERY")).toEqual({ apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" });
  });

  it("BOUNCED -> DELIVERY is a no-op (bounce outranks delivery, out-of-order callback ignored)", () => {
    expect(decideCallbackApplication("BOUNCED", "DELIVERY")).toEqual({ apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" });
  });

  it("COMPLAINED is terminal - nothing outranks it", () => {
    expect(decideCallbackApplication("COMPLAINED", "BOUNCE")).toEqual({ apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" });
  });

  it("callback arrives before local MessageId persistence (attempt still SUBMITTING/UNKNOWN) -> still applies, it's new information", () => {
    expect(decideCallbackApplication("SUBMITTING", "DELIVERY")).toEqual({ apply: true, nextStatus: "DELIVERED" });
    expect(decideCallbackApplication("UNKNOWN", "BOUNCE")).toEqual({ apply: true, nextStatus: "BOUNCED" });
  });

  it("duplicate callback of the exact same kind is idempotent no-op", () => {
    expect(decideCallbackApplication("BOUNCED", "BOUNCE")).toEqual({ apply: false, reason: "NO_OP_NOT_HIGHER_PRECEDENCE" });
  });
});

describe("complaintRequiresSuppression", () => {
  it("COMPLAINT requires suppression, others do not", () => {
    expect(complaintRequiresSuppression("COMPLAINT")).toBe(true);
    expect(complaintRequiresSuppression("BOUNCE")).toBe(false);
    expect(complaintRequiresSuppression("DELIVERY")).toBe(false);
  });
});
