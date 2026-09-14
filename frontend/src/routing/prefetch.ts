/**
 * PERF-09 (Ciclo B) - selective idle-time prefetch.
 *
 * Route-level code splitting (App.tsx) means a route's chunk downloads only when the user first
 * navigates to it. For the Overview screen - the landing page after login for every role - the
 * two most likely next destinations are Items (`/items`, Overview's own primary CTAs: "Ver todos
 * os vencimentos" and every item row link) and Subjects (`/subjects`, the other top-of-nav entry
 * alongside Overview/Items in `shell/navigation.ts`). Prefetching just these two during idle time
 * means their chunks are already cached by the time the user actually clicks, without spending
 * bandwidth/CPU on chunks the user may never visit (every other route stays lazy-only).
 *
 * Uses the exact same dynamic `import()` calls as the corresponding `React.lazy()` factories in
 * App.tsx, so the browser resolves them to the same cached chunk - this module never introduces
 * a second copy of either route's code.
 */

let scheduled = false;

function whenIdle(callback: () => void): void {
  // `requestIdleCallback` is unavailable in some browsers/test environments (e.g. jsdom, Safari
  // as of this writing) - `setTimeout` is the standard fallback, matching the shape (a deadline
  // callback that runs once the main thread is otherwise free-ish) closely enough for a prefetch
  // hint, which is best-effort by nature.
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(callback);
  } else {
    setTimeout(callback, 1);
  }
}

/** Called once (guarded by `scheduled`) when the Overview route mounts - see App.tsx's
 * `IdlePrefetch`. Safe to call more than once; only the first call schedules anything. */
export function prefetchOverviewNextRoutes(): void {
  if (scheduled) return;
  scheduled = true;
  whenIdle(() => {
    void import("../routes/items/ItemsCollection.js");
    void import("../routes/subjects/SubjectsCollection.js");
  });
}
