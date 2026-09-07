import { describe, expect, it } from "vitest";
import { decideSendAction, nextWhatsAppStatusAfterSendAttempt } from "../../../src/modules/notification/application/whatsapp-delivery.js";

describe("decideSendAction (reused verbatim from email-delivery.ts - already channel-agnostic)", () => {
  it("PREPARED -> SEND", () => {
    expect(decideSendAction({ status: "PREPARED" }, "2026-09-10T12:00:00.000Z")).toEqual({ action: "SEND" });
  });

  it("FAILED_RETRYABLE -> SEND (conclusive failure, safe to retry)", () => {
    expect(decideSendAction({ status: "FAILED_RETRYABLE" }, "2026-09-10T12:00:00.000Z")).toEqual({ action: "SEND" });
  });

  it("SUBMITTING with active lease -> SKIP_IN_PROGRESS (never call the Cloud API twice concurrently)", () => {
    expect(decideSendAction({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T12:05:00.000Z" }, "2026-09-10T12:00:00.000Z")).toEqual({
      action: "SKIP_IN_PROGRESS",
    });
  });

  it("SUBMITTING with expired lease -> RECONCILE_UNKNOWN, never resend blindly", () => {
    expect(decideSendAction({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T11:00:00.000Z" }, "2026-09-10T12:00:00.000Z")).toEqual({
      action: "RECONCILE_UNKNOWN",
    });
  });

  for (const status of ["ACCEPTED", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED_TERMINAL", "UNKNOWN", "NOT_SENT_STALE"] as const) {
    it(`${status} -> SKIP_RESOLVED`, () => {
      expect(decideSendAction({ status }, "2026-09-10T12:00:00.000Z")).toEqual({ action: "SKIP_RESOLVED" });
    });
  }
});

describe("nextWhatsAppStatusAfterSendAttempt", () => {
  it("ACCEPTED outcome -> ACCEPTED status", () => {
    expect(nextWhatsAppStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: "m1" })).toBe("ACCEPTED");
  });

  it("CONCLUSIVE_RETRYABLE failure -> FAILED_RETRYABLE", () => {
    expect(nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "CONCLUSIVE_RETRYABLE" })).toBe("FAILED_RETRYABLE");
  });

  it("CONCLUSIVE_TERMINAL failure -> FAILED_TERMINAL", () => {
    expect(nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "CONCLUSIVE_TERMINAL" })).toBe("FAILED_TERMINAL");
  });

  it("AMBIGUOUS failure (timeout after possible acceptance) -> UNKNOWN, never FAILED_RETRYABLE (would risk a blind duplicate retry)", () => {
    expect(nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "AMBIGUOUS" })).toBe("UNKNOWN");
  });
});
