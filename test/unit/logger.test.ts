import { describe, expect, it } from "vitest";
import { runWithContext } from "../../src/shared/observability/context.js";
import { SecureLogger } from "../../src/shared/observability/logger.js";

const CANARY_SECRET = "sk_live_canary_0123456789";
const CANARY_EMAIL = "leak-canary@example.com";

function captureLogger() {
  const lines: string[] = [];
  const logger = new SecureLogger({
    sink: (_level, line) => lines.push(line),
    now: () => "2026-08-19T00:00:00.000Z",
  });
  return { logger, lines };
}

describe("SecureLogger", () => {
  it("emits structured JSON with timestamp/level/event", () => {
    const { logger, lines } = captureLogger();
    logger.info("item_created", { tenantId: "t_01", itemId: "item_01" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("item_created");
    expect(parsed.tenantId).toBe("t_01");
    expect(parsed.timestamp).toBe("2026-08-19T00:00:00.000Z");
  });

  it("redacts secrets/PII passed in log context before serialization", () => {
    const { logger, lines } = captureLogger();
    logger.error("delivery_failed", {
      tenantId: "t_01",
      recipientEmail: CANARY_EMAIL,
      apiKey: CANARY_SECRET,
    });
    expect(lines[0]).not.toContain(CANARY_SECRET);
    // recipientEmail isn't a denylisted field name, but the value itself is redacted
    // via the free-text email pattern applied to every string.
    expect(lines[0]).not.toContain(CANARY_EMAIL);
  });

  it("redacts secrets inside error context values", () => {
    const { logger, lines } = captureLogger();
    logger.error("worker_crashed", {
      error: new Error(`token=${CANARY_SECRET} rejected`),
    });
    expect(lines[0]).not.toContain(CANARY_SECRET);
  });

  it("child() merges persistent context into every subsequent line", () => {
    const { logger, lines } = captureLogger();
    const child = logger.child({ correlationId: "cor_01", tenantId: "t_01" });
    child.info("step_a", {});
    child.info("step_b", { extra: 1 });
    const first = JSON.parse(lines[0]!);
    const second = JSON.parse(lines[1]!);
    expect(first.correlationId).toBe("cor_01");
    expect(second.correlationId).toBe("cor_01");
    expect(second.extra).toBe(1);
  });

  it("inherits correlationId/tenantId from the ambient AsyncLocalStorage context automatically", () => {
    const { logger, lines } = captureLogger();
    runWithContext({ correlationId: "cor_ambient", tenantId: "t_ambient" }, () => {
      logger.info("step_a", {});
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.correlationId).toBe("cor_ambient");
    expect(parsed.tenantId).toBe("t_ambient");
  });

  it("never lets forged per-call context override the real ambient AsyncLocalStorage context", () => {
    // Precedence fix (expiration-tracker-correlationid-trace-join-design-2026-08-29.md §3 item 3):
    // getContext() is more trusted than per-call context, since the latter is caller-supplied
    // metadata that could otherwise silently spoof tenantId/correlationId.
    const { logger, lines } = captureLogger();
    runWithContext({ correlationId: "cor_ambient", tenantId: "t_ambient" }, () => {
      logger.info("step_a", { correlationId: "cor_forged", tenantId: "t_forged" });
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.correlationId).toBe("cor_ambient");
    expect(parsed.tenantId).toBe("t_ambient");
  });

  it("lets explicit context fill in fields the ambient context doesn't set", () => {
    const { logger, lines } = captureLogger();
    runWithContext({ correlationId: "cor_ambient" }, () => {
      logger.info("step_a", { itemId: "item_01" });
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.correlationId).toBe("cor_ambient");
    expect(parsed.itemId).toBe("item_01");
  });

  it("does not leak ambient context into log lines written outside any runWithContext", () => {
    const { logger, lines } = captureLogger();
    logger.info("step_outside", {});
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.correlationId).toBeUndefined();
  });

  it("includes parsed X-Ray trace fields from _X_AMZN_TRACE_ID when present", () => {
    const original = process.env["_X_AMZN_TRACE_ID"];
    process.env["_X_AMZN_TRACE_ID"] = "Root=1-5e1b4151-5ac6c58dc39a56f8dead5e08;Parent=53995c3f42cd8ad8;Sampled=1";
    try {
      const { logger, lines } = captureLogger();
      logger.info("step_a", {});
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.xrayTraceId).toBe("1-5e1b4151-5ac6c58dc39a56f8dead5e08");
      expect(parsed.xraySampled).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env["_X_AMZN_TRACE_ID"];
      } else {
        process.env["_X_AMZN_TRACE_ID"] = original;
      }
    }
  });

  it("omits X-Ray fields entirely when _X_AMZN_TRACE_ID is absent or malformed", () => {
    const original = process.env["_X_AMZN_TRACE_ID"];
    delete process.env["_X_AMZN_TRACE_ID"];
    try {
      const { logger, lines } = captureLogger();
      logger.info("step_a", {});
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.xrayTraceId).toBeUndefined();
      expect(parsed.xraySampled).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env["_X_AMZN_TRACE_ID"];
      } else {
        process.env["_X_AMZN_TRACE_ID"] = original;
      }
    }
  });

  it("never lets forged xray fields in per-call context override the real runtime-derived ones", () => {
    const original = process.env["_X_AMZN_TRACE_ID"];
    process.env["_X_AMZN_TRACE_ID"] = "Root=1-5e1b4151-5ac6c58dc39a56f8dead5e08;Sampled=1";
    try {
      const { logger, lines } = captureLogger();
      logger.info("step_a", { xrayTraceId: "1-fake-fakefakefakefakefakefakefake", xraySampled: false });
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.xrayTraceId).toBe("1-5e1b4151-5ac6c58dc39a56f8dead5e08");
      expect(parsed.xraySampled).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env["_X_AMZN_TRACE_ID"];
      } else {
        process.env["_X_AMZN_TRACE_ID"] = original;
      }
    }
  });

  it("never lets a canary secret survive across log/exception/DLQ-shaped payloads", () => {
    const { logger, lines } = captureLogger();
    logger.warn("dlq_metadata", {
      diagnostic: { rawPayload: { token: CANARY_SECRET }, note: `contact ${CANARY_EMAIL}` },
    });
    expect(lines[0]).not.toContain(CANARY_SECRET);
    expect(lines[0]).not.toContain(CANARY_EMAIL);
  });
});
