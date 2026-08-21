import { describe, expect, it } from "vitest";
import { decideCorrectiveIntentKind, correctiveIdempotencyKey } from "../../../src/modules/notification/application/corrective-intent-service.js";
import type { NotificationAttemptStatus } from "../../../src/modules/notification/domain/notification-attempt.js";

describe("decideCorrectiveIntentKind", () => {
  it("no prior attempt -> REPLACEMENT", () => {
    expect(decideCorrectiveIntentKind(undefined)).toEqual({ kind: "REPLACEMENT" });
  });

  const replacementStates: NotificationAttemptStatus[] = ["PREPARED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "NOT_SENT_STALE"];
  for (const status of replacementStates) {
    it(`${status} -> REPLACEMENT (no delivery could have crossed the external limit)`, () => {
      expect(decideCorrectiveIntentKind(status)).toEqual({ kind: "REPLACEMENT" });
    });
  }

  const correctiveStates: NotificationAttemptStatus[] = ["SUBMITTING", "ACCEPTED", "DELIVERED", "UNKNOWN", "BOUNCED", "COMPLAINED"];
  for (const status of correctiveStates) {
    it(`${status} -> CORRECTIVE (delivery possible or proven)`, () => {
      expect(decideCorrectiveIntentKind(status)).toEqual({ kind: "CORRECTIVE" });
    });
  }
});

describe("correctiveIdempotencyKey", () => {
  it("REPLACEMENT and CORRECTIVE produce distinct keys for the same intent/version", () => {
    const base = { tenantId: "t1", supersededIntentId: "int-1", currentItemVersion: 4 } as const;
    const replacement = correctiveIdempotencyKey({ ...base, kind: "REPLACEMENT" });
    const corrective = correctiveIdempotencyKey({ ...base, kind: "CORRECTIVE" });
    expect(replacement).not.toBe(corrective);
    expect(replacement).toBe("t1|int-1|4|REPLACEMENT");
  });
});
