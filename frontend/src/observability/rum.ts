/**
 * CloudWatch RUM scaffolding (Performance Program plan §22/PERF-02) — NOT wired to a real AWS
 * RUM app monitor yet. This module is intentionally a no-op until three prerequisites exist,
 * none of which this slice creates (infra change, out of scope here):
 *
 *   1. An AWS RUM app monitor resource provisioned via Terraform (infra/) — gives us the
 *      `identityPoolId`/`applicationId`/`guestRoleArn` this client needs.
 *   2. The `aws-rum-web` npm package added as a real dependency (not added by this slice).
 *   3. `VITE_RUM_APPLICATION_ID` (+ related config) set in the deploy environment — dev only,
 *      per the plan ("low sampling, dev-only, no sensitive data").
 *
 * Until then, `initRum()` is a safe no-op everywhere (including prod), and every other module
 * in `src/observability/` degrades to console/no-op exactly like `report.ts` already does when
 * no vendor is configured — this file follows the same SDK-agnostic port pattern.
 */

export interface RumClient {
  recordEvent(name: string, data: Record<string, unknown>): void;
}

let client: RumClient | undefined;

/** Test-only escape hatch, mirrors `setObservabilitySink` in report.ts. */
export function setRumClient(next: RumClient | undefined): void {
  client = next;
}

/** `import.meta.env` typing doesn't exist yet in this codebase (no vite-env.d.ts) - read
 * defensively via a cast so this never throws in a test/SSR context without that global, and so
 * every call site here shares one narrow `any`-cast instead of repeating it. */
function readViteEnv(): { DEV?: boolean; [key: string]: string | boolean | undefined } {
  try {
    return (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env ?? {};
  } catch {
    return {};
  }
}

function isRumConfigured(): boolean {
  return Boolean(readViteEnv()["VITE_RUM_APPLICATION_ID"]);
}

/**
 * Call once from main.tsx's bootstrap. No-op today (see module doc) — becomes the real
 * `aws-rum-web` `AwsRum` construction once the app monitor + package + env var exist. Kept
 * idempotent and side-effect-free when unconfigured so calling it unconditionally is safe.
 */
export function initRum(): void {
  if (!isRumConfigured()) return;
  // Real init goes here once aws-rum-web is a dependency, e.g.:
  //   const { AwsRum } = await import("aws-rum-web");
  //   client = new AwsRum(applicationId, applicationVersion, region, config);
  // Deliberately left unimplemented - this branch is unreachable until VITE_RUM_APPLICATION_ID
  // is actually set, which today it never is (no env config ships it).
}

/** Records a custom RUM metric. No-op (besides an optional console trace in dev) until a real
 * client is configured via `initRum()`. Never pass domain data (item names, emails, etc.) in
 * `data` - same NEVER-log discipline as `report.ts`. */
export function recordRumMetric(name: string, data: Record<string, unknown> = {}): void {
  if (client) {
    client.recordEvent(name, data);
    return;
  }
  if (readViteEnv().DEV) {
    // eslint-disable-next-line no-console -- dev-only trace so the metric is visible locally
    // before a real RUM client exists; production builds never reach this (client is undefined
    // and DEV is false).
    console.debug(`[rum:${name}]`, data);
  }
}
