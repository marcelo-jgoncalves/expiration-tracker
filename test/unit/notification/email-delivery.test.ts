import { describe, expect, it } from "vitest";
import { decideSendAction, nextStatusAfterSendAttempt } from "../../../src/modules/notification/application/email-delivery.js";

describe("decideSendAction", () => {
  it("PREPARED -> SEND", () => {
    expect(decideSendAction({ status: "PREPARED" }, "2026-09-10T12:00:00.000Z")).toEqual({ action: "SEND" });
  });

  it("FAILED_RETRYABLE -> SEND (conclusive failure, safe to retry)", () => {
    expect(decideSendAction({ status: "FAILED_RETRYABLE" }, "2026-09-10T12:00:00.000Z")).toEqual({ action: "SEND" });
  });

  it("SUBMITTING with active lease -> SKIP_IN_PROGRESS (never call SES twice concurrently)", () => {
    expect(
      decideSendAction({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T12:05:00.000Z" }, "2026-09-10T12:00:00.000Z"),
    ).toEqual({ action: "SKIP_IN_PROGRESS" });
  });

  it("SUBMITTING with expired lease -> RECONCILE_UNKNOWN, never resend blindly", () => {
    expect(
      decideSendAction({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T11:00:00.000Z" }, "2026-09-10T12:00:00.000Z"),
    ).toEqual({ action: "RECONCILE_UNKNOWN" });
  });

  it("SUBMITTING with no lease recorded at all -> RECONCILE_UNKNOWN", () => {
    expect(decideSendAction({ status: "SUBMITTING" }, "2026-09-10T12:00:00.000Z")).toEqual({ action: "RECONCILE_UNKNOWN" });
  });

  for (const status of ["ACCEPTED", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED_TERMINAL", "UNKNOWN", "NOT_SENT_STALE"] as const) {
    it(`${status} -> SKIP_RESOLVED`, () => {
      expect(decideSendAction({ status }, "2026-09-10T12:00:00.000Z")).toEqual({ action: "SKIP_RESOLVED" });
    });
  }
});

describe("nextStatusAfterSendAttempt", () => {
  it("ACCEPTED outcome -> ACCEPTED status", () => {
    expect(nextStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: "m1" })).toBe("ACCEPTED");
  });

  it("CONCLUSIVE_RETRYABLE failure -> FAILED_RETRYABLE", () => {
    expect(nextStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "CONCLUSIVE_RETRYABLE" })).toBe("FAILED_RETRYABLE");
  });

  it("CONCLUSIVE_TERMINAL failure -> FAILED_TERMINAL", () => {
    expect(nextStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "CONCLUSIVE_TERMINAL" })).toBe("FAILED_TERMINAL");
  });

  it("AMBIGUOUS failure (timeout after possible acceptance) -> UNKNOWN, never FAILED_RETRYABLE (would risk a blind duplicate retry)", () => {
    expect(nextStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "AMBIGUOUS" })).toBe("UNKNOWN");
  });
});
