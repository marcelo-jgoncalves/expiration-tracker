import { describe, expect, it } from "vitest";
import { correlationIdFromSqsRecord, getContext, runWithContext } from "../../src/shared/observability/context.js";

describe("runWithContext / getContext", () => {
  it("exposes the current context inside run()", () => {
    runWithContext({ correlationId: "cor_01", tenantId: "t_01" }, () => {
      expect(getContext()).toEqual({ correlationId: "cor_01", tenantId: "t_01" });
    });
  });

  it("returns undefined outside any run()", () => {
    expect(getContext()).toBeUndefined();
  });

  it("isolates context across sequential records in the same batch loop", () => {
    const seen: Array<string | undefined> = [];
    const records = [
      { correlationId: "cor_a" },
      { correlationId: "cor_b" },
      { correlationId: "cor_c" },
    ];
    for (const record of records) {
      runWithContext(record, () => {
        seen.push(getContext()?.correlationId);
      });
    }
    expect(seen).toEqual(["cor_a", "cor_b", "cor_c"]);
    expect(getContext()).toBeUndefined();
  });

  it("does not leave context 'stuck' for the next record when one record throws", () => {
    const records = [{ correlationId: "cor_fails" }, { correlationId: "cor_next" }];

    expect(() =>
      runWithContext(records[0]!, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(getContext()).toBeUndefined();

    runWithContext(records[1]!, () => {
      expect(getContext()?.correlationId).toBe("cor_next");
    });
  });

  it("supports nested runWithContext to update tenantId mid-record without mutating the outer store", () => {
    runWithContext({ correlationId: "cor_01" }, () => {
      expect(getContext()).toEqual({ correlationId: "cor_01" });

      runWithContext({ correlationId: "cor_01", tenantId: "t_01" }, () => {
        expect(getContext()).toEqual({ correlationId: "cor_01", tenantId: "t_01" });
      });

      expect(getContext()).toEqual({ correlationId: "cor_01" });
    });
  });
});

describe("correlationIdFromSqsRecord", () => {
  it("reads the correlationId the relay/sweeper propagated via MessageAttributes - the actual outbox->SQS->Lambda causality link", () => {
    const record = { messageId: "msg-1", messageAttributes: { correlationId: { stringValue: "cor_original" } } };
    expect(correlationIdFromSqsRecord(record)).toBe("cor_original");
  });

  it("falls back to the SQS messageId when the attribute is absent (pre-M5 in-flight message, or a source with no upstream correlationId)", () => {
    const record = { messageId: "msg-2", messageAttributes: {} };
    expect(correlationIdFromSqsRecord(record)).toBe("msg-2");
  });

  it("falls back to the SQS messageId when messageAttributes itself is absent", () => {
    const record = { messageId: "msg-3" };
    expect(correlationIdFromSqsRecord(record)).toBe("msg-3");
  });
});
