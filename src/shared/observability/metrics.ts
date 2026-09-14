/**
 * emitMetric — E-018/E-021 (full-audit round2): closes the "no custom metrics/dashboard exist"
 * gap, protocol Claude↔Codex APPROVED (3 rounds, 6,8→7,2→9,2, `docs/architecture/reviews/
 * emf-metrics-dashboard-scoping/`). Writes CloudWatch Embedded Metric Format (EMF) — a
 * structured log line CloudWatch Logs parses into a real custom metric, no `PutMetricData` SDK
 * call, no new IAM permission (every Lambda already has `logs:PutLogEvents` via
 * `AWSLambdaBasicExecutionRole`).
 *
 * **Never call this from `src/workers/**`** — workers are deliberately observability-agnostic
 * (`AGENTS.md` §7/E-007). Only the real Lambda handlers in `src/runtime/aws/handlers/` call
 * this, right next to the `logger.info(..., { outcome: ... })` call that already exists there.
 *
 * **Dimension discipline (E-014 external research, AWS EMF spec + this project's own
 * `logger.ts` precedent)**: `tenantId` (or any other high-cardinality value — a user id, a
 * request id) must NEVER be a metric dimension — each unique dimension combination is a
 * separately-billed custom metric, and tenant count grows without bound. `Outcome` values used
 * as dimensions here are closed, low-cardinality unions (5-9 members, enumerated at each real
 * call site) — safe. Per-tenant investigation is a CloudWatch Logs Insights query against the
 * structured logs (which already carry `tenantId` via `runWithContext`), never a metric
 * dimension — see `infra/modules/observability-dashboard/`'s log widgets.
 */

export interface MetricPoint {
  name: string;
  value: number;
  unit: "Count" | "Milliseconds";
  /** Closed, low-cardinality dimension values only (an Outcome union member, a fixed
   * destination name) — never a tenantId/userId/requestId. See the module doc comment above. */
  dimensions?: Record<string, string>;
}

export interface MetricSink {
  write(line: string): void;
}

const defaultSink: MetricSink = { write: (line: string) => console.log(line) };

function buildEmfLine(namespace: string, point: MetricPoint): Record<string, unknown> {
  const dimensionNames = Object.keys(point.dimensions ?? {});
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: dimensionNames.length > 0 ? [dimensionNames] : [[]],
          Metrics: [{ Name: point.name, Unit: point.unit }],
        },
      ],
    },
    ...point.dimensions,
    [point.name]: point.value,
  };
}

/**
 * Never throws — a failure to serialize/write a metric must never take down the business
 * handler calling it, same discipline `SecureLogger` already follows for logging itself.
 * `namespace` groups metrics in the CloudWatch console (e.g. `"ExpirationTracker/ReminderDispatch"`).
 */
export function emitMetric(namespace: string, point: MetricPoint, sink: MetricSink = defaultSink): void {
  try {
    sink.write(JSON.stringify(buildEmfLine(namespace, point)));
  } catch {
    // Swallowed deliberately — see the doc comment above. Nothing to log here either (the
    // logger itself could be the thing failing in a truly pathological case); this is the one
    // place in the codebase allowed to fail completely silently, by design.
  }
}
