/**
 * Minimal frontend observability adapter (mission §53-54): uncaught errors, BFF/route/auth
 * failures, critical mutation failures. No vendor chosen yet - a real one (Sentry, etc.)
 * plugs into the `ObservabilitySink` port below without any call site changing, matching
 * this project's SDK-agnostic port pattern (src/shared/idempotency/idempotency.ts) applied
 * to the frontend.
 *
 * NEVER log (mission §55): tokens, cookies, guest tokens, PII, document names/content. The
 * `context` parameter is for structural metadata only (a route path, a component name) -
 * callers must never pass a domain value (item name, email, etc.) through it.
 */

export interface ObservabilityEvent {
  kind: "uncaught_error" | "bff_failure" | "route_failure" | "auth_failure" | "critical_mutation_failure";
  message: string;
  context?: Record<string, string>;
}

export interface ObservabilitySink {
  report(event: ObservabilityEvent): void;
}

/** Default sink: browser console only. Fine for this foundation stage (no real users yet);
 * swapping in a real vendor is a one-line change to `sink` below, never a call-site rewrite. */
const consoleSink: ObservabilitySink = {
  report(event) {
    // eslint-disable-next-line no-console -- this IS the observability sink; a future real
    // vendor adapter replaces this exact call, nothing else in the app should call console.*.
    console.error(`[observability:${event.kind}]`, event.message, event.context ?? {});
  },
};

let sink: ObservabilitySink = consoleSink;

/** Test-only escape hatch and the eventual real-vendor wiring point - never called from
 * application code outside main.tsx's bootstrap. */
export function setObservabilitySink(next: ObservabilitySink): void {
  sink = next;
}

export function reportUncaughtError(error: Error, context?: Record<string, string>): void {
  sink.report({ kind: "uncaught_error", message: error.message, context });
}

export function reportBffFailure(message: string, context?: Record<string, string>): void {
  sink.report({ kind: "bff_failure", message, context });
}

export function reportAuthFailure(message: string, context?: Record<string, string>): void {
  sink.report({ kind: "auth_failure", message, context });
}

export function reportCriticalMutationFailure(message: string, context?: Record<string, string>): void {
  sink.report({ kind: "critical_mutation_failure", message, context });
}
