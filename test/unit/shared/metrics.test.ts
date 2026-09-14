/**
 * E-018/E-021 (full-audit round2) — `emitMetric()` closes the "no custom metrics exist" gap,
 * protocol Claude↔Codex APPROVED (`docs/architecture/reviews/emf-metrics-dashboard-scoping/`).
 */
import { describe, expect, it } from "vitest";
import { emitMetric, type MetricSink } from "../../../src/shared/observability/metrics.js";

function recordingSink(): MetricSink & { lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe("emitMetric", () => {
  it("writes a well-formed EMF line with the real CloudWatchMetrics envelope, namespace, and metric name/value/unit", () => {
    const sink = recordingSink();
    emitMetric("ExpirationTracker/ReminderDispatch", { name: "OccurrenceDispatchOutcome", value: 1, unit: "Count", dimensions: { Outcome: "TRIGGERED" } }, sink);

    expect(sink.lines).toHaveLength(1);
    const parsed = JSON.parse(sink.lines[0]!);
    expect(parsed["_aws"]["CloudWatchMetrics"][0]["Namespace"]).toBe("ExpirationTracker/ReminderDispatch");
    expect(parsed["_aws"]["CloudWatchMetrics"][0]["Dimensions"]).toEqual([["Outcome"]]);
    expect(parsed["_aws"]["CloudWatchMetrics"][0]["Metrics"]).toEqual([{ Name: "OccurrenceDispatchOutcome", Unit: "Count" }]);
    expect(parsed["Outcome"]).toBe("TRIGGERED");
    expect(parsed["OccurrenceDispatchOutcome"]).toBe(1);
  });

  it("omits the Dimensions entry's inner array when no dimensions are given, never a broken/empty-key EMF line", () => {
    const sink = recordingSink();
    emitMetric("ExpirationTracker/Test", { name: "SomeMetric", value: 1, unit: "Count" }, sink);
    const parsed = JSON.parse(sink.lines[0]!);
    expect(parsed["_aws"]["CloudWatchMetrics"][0]["Dimensions"]).toEqual([[]]);
  });

  it("G-V3: never throws when the sink itself throws - a metrics failure must never take down the business handler calling it", () => {
    const throwingSink: MetricSink = {
      write: () => {
        throw new Error("simulated CloudWatch Logs write failure");
      },
    };
    // Mutation this test would catch: removing the try/catch in emitMetric() would make this
    // call throw and fail the test.
    expect(() => emitMetric("ExpirationTracker/Test", { name: "X", value: 1, unit: "Count" }, throwingSink)).not.toThrow();
  });

  it("defaults to console.log as the sink when none is injected (real production path, not just the testable one)", () => {
    // Deliberately verifying the real default sink - the one exception this test file has a
    // reason to touch console directly.
    // eslint-disable-next-line no-console
    const original = console.log;
    const calls: string[] = [];
    // eslint-disable-next-line no-console
    console.log = (line: string) => calls.push(line);
    try {
      emitMetric("ExpirationTracker/Test", { name: "X", value: 1, unit: "Count" });
    } finally {
      // eslint-disable-next-line no-console
      console.log = original;
    }
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!)["X"]).toBe(1);
  });
});
