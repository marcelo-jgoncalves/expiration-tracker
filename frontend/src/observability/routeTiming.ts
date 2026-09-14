/**
 * `ET_ROUTE_USEFUL_CONTENT_MS` (Performance Program plan §22/PERF-02) — time from route
 * navigation start to the route's content settling on screen, using the browser Performance
 * API (`performance.mark`/`performance.measure`, no extra dependency).
 *
 * Scaffolding note: this measures a *generic* proxy for "useful content painted" (two
 * `requestAnimationFrame` ticks after the route's DOM commits, which is the standard trick to
 * wait for the browser to actually paint rather than just finish React's render/commit phase -
 * same idea as web-vitals' internal double-rAF for similar metrics). It is NOT per-route-aware
 * of async data loading (e.g. a route that shows a skeleton immediately then swaps in TanStack
 * Query data 400ms later reports the skeleton's paint time, not the data's). Wiring an accurate
 * per-route "useful data is visible" signal is future work once routes want to opt into it
 * explicitly (call `markRouteUsefulContent` from a route's own effect instead of relying on the
 * generic hook, if that route wants a more precise number) - this generic version is enough to
 * validate the pipeline (mark -> measure -> report) end to end.
 */
import { useEffect, useRef } from "react";
import { recordRumMetric } from "./rum.js";

const METRIC_NAME = "ET_ROUTE_USEFUL_CONTENT_MS";

function markRouteNavigationStart(routeId: string): void {
  performance.mark(`route-nav-start:${routeId}`);
}

function markRouteUsefulContent(routeId: string): void {
  const startMark = `route-nav-start:${routeId}`;
  const endMark = `route-useful-content:${routeId}`;
  const measureName = `route-useful-content-duration:${routeId}`;
  try {
    if (performance.getEntriesByName(startMark).length === 0) return; // no matching start, skip
    performance.mark(endMark);
    const measure = performance.measure(measureName, startMark, endMark);
    recordRumMetric(METRIC_NAME, { route: routeId, durationMs: Math.round(measure.duration) });
  } finally {
    // Keep the Performance timeline tidy across route changes in a long-lived SPA session.
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(measureName);
  }
}

/**
 * Wire once at the router/shell level (see App.tsx), not per-route-component - it derives the
 * route id from whatever the caller passes (e.g. `location.pathname`) and re-arms on every
 * change. Structural metadata only (a path), never domain data - same NEVER-log discipline as
 * `observability/report.ts`.
 */
export function useRouteUsefulContentTiming(routeId: string): void {
  const previousRouteId = useRef<string | undefined>(undefined);

  useEffect(() => {
    markRouteNavigationStart(routeId);
    previousRouteId.current = routeId;

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (previousRouteId.current === routeId) markRouteUsefulContent(routeId);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed only on
    // routeId: re-running this on any other dependency would re-mark navigation start without
    // an actual navigation happening.
  }, [routeId]);
}
