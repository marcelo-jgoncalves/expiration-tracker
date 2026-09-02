/**
 * Security audit trail — closed-taxonomy events for the two real gaps identified in
 * full-audit-round1-focused-round2-summary.md (Segurança-Logging/OWASP A09:2025, SRE-Detecção):
 * authorization denials and access to the global GSI3/GSI6 indexes have no dedicated audit
 * trail today, only exception/HTTP response. Design:
 * docs/architecture/reviews/security-audit-trail-design/codex-reconciliation-round2-final-design.md
 *
 * Deliberately NOT a new DynamoDB entity — an authorization denial has no mutation to share a
 * transaction with (nothing is written), and a GSI query is a read, not a mutation; a
 * best-effort separate PutItem would fake the atomicity guarantee that makes the existing
 * AuditEvent pattern (src/modules/expiration/domain/audit-event.ts) valuable. Instead: 3
 * closed-shape functions over the existing SecureLogger, which already redacts and
 * auto-injects correlationId/tenantId from the AsyncLocalStorage context - CloudWatch Logs is
 * the durable trail at this stage, with metric filters + real alarms wired to the existing
 * SNS alert topic (infra/modules/security-audit-observability).
 *
 * Every function here takes a closed, typed shape — never `Record<string, unknown>` — so this
 * module can never become an accidental channel for tokens, resource IDs, DynamoDB keys, or
 * business payloads. `authorize()` itself stays pure (no I/O, no dependency on this module) -
 * these are called only at the boundary that already catches AuthorizationDeniedError (4 real
 * HTTP handlers) or wraps a GSI3/GSI6 query (3 real persistence adapters).
 */
import { logger } from "./logger.js";

// `reason`/`action` are typed as `string` here, not imported from
// modules/identity/domain/authorization.js's closed unions - src/shared/** must never depend
// on a domain module (wrong direction: domain is the innermost layer). Callers there already
// have the closed-union values (AuthorizationDeniedError#reason/#action) and pass them through
// unchanged - the type safety lives at the call site, not by this module importing domain types.

export type GlobalIndexName = "GSI3" | "GSI6" | "GSI8";

export type GlobalIndexOperation = "Query";

/** Closed set of components that legitimately query GSI3/GSI6/GSI8 - the original 3 privileged
 * roles proven IAM-isolated (docs/architecture/reviews/camada3-iam-negative-test-2026-08-21.md)
 * plus "upload-slot-reconciliation" (M6 design — a real structural change to what used to be a
 * closed set of exactly 2 GSI6 consumers, acknowledged explicitly, not silently expanded),
 * "document-purge" (W3-06/D-061 — the fourth GSI6 consumer, acknowledged explicitly in
 * `docs/architecture/reviews/w3-06-user-document-purge-design/`), "membership-purge" (D-179/D-180
 * — the first of the 9 GSI8/MaintenanceDueIndex consumers named by the approved design), and
 * "invitation-purge" (D-179/D-181, slice 2 of 9); each future worker that migrates joins this
 * list explicitly, never a silent widening. */
export type GlobalIndexComponent =
  | "reminder-producer"
  | "reminder-reconciliation"
  | "outbox-sweeper-reminder-dispatch"
  | "upload-slot-reconciliation"
  | "document-purge"
  | "membership-purge"
  | "invitation-purge";

export function auditAuthorizationDenied(input: { reason: string; action: string }): void {
  logger.warn("security.authorization_denied", {
    reason: input.reason,
    action: input.action,
  });
}

export function auditGlobalIndexAccess(input: {
  indexName: GlobalIndexName;
  operation: GlobalIndexOperation;
  component: GlobalIndexComponent;
  pageCount: number;
  resultCount: number;
}): void {
  logger.info("security.global_index_access", {
    indexName: input.indexName,
    operation: input.operation,
    component: input.component,
    pageCount: input.pageCount,
    resultCount: input.resultCount,
  });
}

export function auditGlobalIndexAccessDenied(input: {
  indexName: GlobalIndexName;
  operation: GlobalIndexOperation;
  component: GlobalIndexComponent;
  awsErrorCode: string;
}): void {
  logger.warn("security.global_index_access_denied", {
    indexName: input.indexName,
    operation: input.operation,
    component: input.component,
    awsErrorCode: input.awsErrorCode,
  });
}

/** True only for the specific AWS SDK error this module is allowed to classify as a security
 * denial - never a generic catch-all, so a real dependency/throttling failure is never
 * misreported as a security event. */
export function isAccessDeniedError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && (err as { name?: unknown }).name === "AccessDeniedException";
}
