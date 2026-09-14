/**
 * PERF-02 slice 2 — shared timing helpers for Lambda handlers, extracted from bff-handler.ts's
 * original inline pattern (slice 1) so every resource Lambda handler doesn't hand-roll the same
 * cold-start/total_ms bookkeeping. Two helpers:
 *  - `withHandlerTiming` wraps an entire handler function: cold-start detection (module-level
 *    flag, true only for the first invocation of a given execution environment) + total_ms.
 *  - `timeSpan` wraps a sub-operation inside a handler (request context resolution, business
 *    logic) with its own ms timing, logged + emitted as its own metric.
 * Both log via the existing `logger` and emit CloudWatch EMF metrics via `emitMetric` — no new
 * observability primitives, see metrics.ts's dimension-discipline doc comment (never a
 * tenantId/userId/requestId as a dimension value).
 */
import { logger } from "./logger.js";
import { emitMetric } from "./metrics.js";

/**
 * Wraps a handler function with cold-start detection + `lambda.total_ms`. `isColdStart` is
 * closed over per call to this factory, i.e. per handler module — matches bff-handler.ts's
 * original module-level `let isColdStart = true` (module state survives across warm
 * invocations of the same execution environment, never across cold ones).
 */
export function withHandlerTiming<Event, Result>(
  namespace: string,
  handlerLabel: string,
  fn: (event: Event) => Promise<Result>,
): (event: Event) => Promise<Result> {
  let isColdStart = true;
  return async (event: Event): Promise<Result> => {
    const coldStart = isColdStart;
    isColdStart = false;
    const start = Date.now();
    try {
      return await fn(event);
    } finally {
      const totalMs = Date.now() - start;
      logger.info(`${handlerLabel} total timing`, { totalMs, coldStart });
      emitMetric(namespace, { name: "lambda.total_ms", value: totalMs, unit: "Milliseconds", dimensions: { cold_start: String(coldStart) } });
    }
  };
}

/** Times a single sub-operation (e.g. request context resolution, business logic) within an
 * already-running handler and emits it as its own metric point, alongside a log line. */
export async function timeSpan<T>(
  namespace: string,
  metricName: string,
  logEvent: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - start;
    logger.info(logEvent, { ms });
    emitMetric(namespace, { name: metricName, value: ms, unit: "Milliseconds" });
  }
}
