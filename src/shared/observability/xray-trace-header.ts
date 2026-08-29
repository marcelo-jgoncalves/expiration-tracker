/**
 * Parses AWS Lambda's reserved `_X_AMZN_TRACE_ID` env var into structured, validated fields for
 * SecureLogger - never the raw header (expiration-tracker-correlationid-trace-join-design-2026-08-29.md,
 * APPROVED via AGENTS.md §4, Claude 9.3/Codex 9.4). Deterministic, field-order-independent, never
 * throws (fail-open: any unparseable/malformed input yields undefined, never a partial/garbage result
 * for the field in question).
 *
 * `Root` is validated against the documented X-Ray trace ID format so an untrusted upstream caller
 * can't smuggle an arbitrary value into structured logs under a field name that implies it's a real
 * trace ID. `Sampled` only accepts the literal "0"/"1". `Parent` is intentionally NOT surfaced in v1
 * (design v2 Round 4): xrayTraceId + xraySampled already close the real operational join use case,
 * and Parent is easy to misread as "this log line's own span" when it is actually the parent context
 * received in the header - a decision of simplicity, not a blocker to revisit later. `Lineage` is
 * explicitly ignored per AWS guidance not to rely on it directly.
 *
 * Cardinality note: correlationId and xrayTraceId are NOT 1:1. A single logical business flow (one
 * correlationId) crosses multiple real Lambda invocations (HTTP -> SQS -> Step Functions -> ...),
 * each with its own X-Ray trace - this is an observational join between application and tracing
 * context, never an equivalence.
 *
 * Sampling note: xraySampled: false can legitimately appear alongside a valid xrayTraceId - it means
 * that specific invocation has no trace persisted/queryable in X-Ray (normal sampling behavior, not
 * an integration failure).
 */
export interface XrayTraceHeaderFields {
  xrayTraceId?: string;
  xraySampled?: boolean;
}

const ROOT_PATTERN = /^1-[0-9a-fA-F]{8}-[0-9a-fA-F]{24}$/;

export function parseXrayTraceHeader(raw: string | undefined): XrayTraceHeaderFields | undefined {
  if (!raw) {
    return undefined;
  }

  const fields: XrayTraceHeaderFields = {};

  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();

    if (key === "Root" && ROOT_PATTERN.test(value)) {
      fields.xrayTraceId = value;
    } else if (key === "Sampled" && (value === "0" || value === "1")) {
      fields.xraySampled = value === "1";
    }
    // Parent: not surfaced in v1 (see header doc). Lineage: explicitly ignored. Unknown keys: ignored.
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}
