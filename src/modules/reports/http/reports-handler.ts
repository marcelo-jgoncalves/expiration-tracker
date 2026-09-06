/**
 * Roadmap P0.7 ("Relatórios, Exportação e Audit Trail"), fatias 1-2. Dedicated CSV route family,
 * one Lambda serving all 7 GET /reports/* routes — same reasons `export-handler.ts`
 * (D-123/D-126) is its own module rather than folded into a generic JSON `HttpResponse` pipeline
 * (raw CSV body, `Content-Disposition`, no JSON envelope). A single dedicated module (not 7) is
 * a deliberate choice within the delegated engineering authority for this slice: every report
 * shares the identical CSV-building/RBAC/audit-free shape `export-handler.ts` already
 * established, so 7 near-identical Lambdas would duplicate infra wiring without a matching
 * behavioral difference (unlike `/items/export`'s own dedicated `timeout_seconds=25`, which
 * exists for a REAL reason — a page budget no other route shares).
 */
import { AppError, AuthorizationError, NotFoundError, toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError, authorize } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import { buildExpirationItemCsv, buildRequirementCsv } from "../application/report-csv.js";
import { ReportsService } from "../application/reports-service.js";
import type { CreateReportSubscriptionInput, ReportSubscriptionService } from "../application/report-subscription-service.js";
import { reportSubscriptionRunKey, type ReportSubscriptionRun } from "../domain/report-subscription-run.js";
import { reportDeliveryAttemptKey, type ReportDeliveryAttempt } from "../domain/report-delivery-attempt.js";
import type { ReportSubscriptionStore } from "../ports/report-subscription-store.js";
import type { ReportExportStore } from "../ports/report-export-store.js";

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
  BUSINESS_RULE: 422,
};

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface CsvHttpResponse {
  statusCode: number;
  csv: string;
  filename: string;
  /** Surfaced only when the report hit `ReportPage.truncated` — never present otherwise
   * (`toApiGatewayCsvResult` omits the header entirely when this is undefined). */
  truncated?: boolean;
}

export interface ReportsHttpDeps {
  resolver: RequestContextResolver;
  reports: ReportsService;
  quota: TenantQuotaService;
  subscriptions: ReportSubscriptionService;
  /** D-204 fatia 3 (decision 7): download route deps - subscription store to read the frozen
   * `ReportSubscriptionRun`/`ReportDeliveryAttempt` rows the delivery worker writes, S3 store to
   * mint the short-lived (5 min) presigned GET on demand. Both optional so this same
   * `ReportsHttpDeps` shape keeps working for any test/composition that only exercises the CSV
   * routes/subscription CRUD above - a route actually hitting the download handler without them
   * wired is a composition bug, surfaced as a real throw, not a silent 500. */
  subscriptionStore?: ReportSubscriptionStore;
  exportStore?: ReportExportStore;
}

/** Filename built ENTIRELY from server-controlled values (report name literal, tenantId, a
 * timestamp) — same posture `export-handler.ts`'s own `buildExportFilename` doc comment
 * requires (Content-Disposition header-injection guard). */
function buildReportFilename(reportName: string, tenantId: string, now: () => string): string {
  const timestamp = now().replace(/[:.]/g, "-");
  return `${reportName}-${tenantId}-${timestamp}.csv`;
}

interface ReportRoute {
  reportName: string;
  run: (deps: ReportsHttpDeps, ctx: Awaited<ReturnType<RequestContextResolver["resolve"]>>) => Promise<{ csv: string; truncated: boolean }>;
}

const ROUTES: Record<string, ReportRoute> = {
  "GET /reports/expired-items": {
    reportName: "expired-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpiredItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/expiring-soon-items": {
    reportName: "expiring-soon-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpiringSoonItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/renewed-items": {
    reportName: "renewed-items",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRenewedItems(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/expiration-items-by-assignee": {
    reportName: "expiration-items-by-assignee",
    run: async (deps, ctx) => {
      const page = await deps.reports.getExpirationItemsByAssignee(ctx);
      return { csv: buildExpirationItemCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/missing-requirements": {
    reportName: "missing-requirements",
    run: async (deps, ctx) => {
      const page = await deps.reports.getMissingRequirements(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/requirements-by-subject": {
    reportName: "requirements-by-subject",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRequirementsBySubject(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
  "GET /reports/requirements-by-assignee": {
    reportName: "requirements-by-assignee",
    run: async (deps, ctx) => {
      const page = await deps.reports.getRequirementsByAssignee(ctx);
      return { csv: buildRequirementCsv(page.rows), truncated: page.truncated };
    },
  },
};

export const REPORT_ROUTE_KEYS = Object.keys(ROUTES);

async function consumeApiRequestQuota(deps: ReportsHttpDeps, context: Awaited<ReturnType<RequestContextResolver["resolve"]>>): Promise<void> {
  await deps.quota.consume({
    tenantId: context.tenant.tenantId,
    quotaType: "API_REQUEST",
    window: "current",
    limit: 100,
    windowSeconds: 60,
  });
}

export async function handleReportsRoute(
  deps: ReportsHttpDeps,
  routeKey: string,
  req: HttpRequest,
  now: () => string = () => new Date().toISOString(),
): Promise<HttpResponse | CsvHttpResponse> {
  const route = ROUTES[routeKey];
  if (!route) {
    return { statusCode: 400, body: new ValidationError(`Unknown route: ${routeKey}`).toJSON() };
  }
  try {
    const context = await deps.resolver.resolve({
      claims: req.claims,
      requestId: req.requestId,
      correlationId: req.correlationId,
      organizationIdHint: req.headers?.["x-organization-id"],
    });
    await consumeApiRequestQuota(deps, context);
    const { csv, truncated } = await route.run(deps, context);
    const filename = buildReportFilename(route.reportName, context.tenant.tenantId, now);
    return { statusCode: 200, csv, filename, truncated: truncated || undefined };
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      const appError = new AuthorizationError(err.message, { reason: err.reason });
      return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
  }
}

// --- ReportSubscription CRUD (D-204 decision 1, implemented D-213) -------------------------
// JSON-envelope routes (never CSV) - same pipeline as document-archive-handlers.ts (resolve
// context -> schema validation -> service, which authorizes internally -> AppError -> status
// mapping). The Lambda entrypoint (reports-handler.ts under runtime/aws/handlers) discriminates
// CSV vs JSON responses via `"csv" in response`, so these can share the same Lambda/module as
// the 7 CSV routes above without any response-shape ambiguity.

const SUBSCRIPTION_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/report-subscription-create-request.v1.json";
const SUBSCRIPTION_DELETE_SCHEMA_ID = "https://expiration-tracker/schemas/api/report-subscription-delete-request.v1.json";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

function requireSubscriptionId(req: HttpRequest): string {
  const subscriptionId = req.pathParameters?.["subscriptionId"];
  if (!subscriptionId) throw new ValidationError("Missing subscriptionId path parameter.");
  return subscriptionId;
}

async function resolveContext(deps: ReportsHttpDeps, req: HttpRequest) {
  const context = await deps.resolver.resolve({
    claims: req.claims,
    requestId: req.requestId,
    correlationId: req.correlationId,
    organizationIdHint: req.headers?.["x-organization-id"],
  });
  await consumeApiRequestQuota(deps, context);
  return context;
}

async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return { statusCode: STATUS_BY_CATEGORY["AUTHORIZATION"] ?? 403, body: new AuthorizationError(err.message, { reason: err.reason }).toJSON() };
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
  }
}

export async function handleCreateReportSubscription(deps: ReportsHttpDeps, req: HttpRequest<CreateReportSubscriptionInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SUBSCRIPTION_CREATE_SCHEMA_ID, req.body);
    const context = await resolveContext(deps, req);
    const subscription = await deps.subscriptions.createSubscription(context, req.body);
    return { statusCode: 201, body: { subscription } };
  });
}

export async function handleGetReportSubscription(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subscriptionId = requireSubscriptionId(req);
    const context = await resolveContext(deps, req);
    const subscription = await deps.subscriptions.getSubscription(context, subscriptionId);
    return { statusCode: 200, body: { subscription } };
  });
}

export async function handleListReportSubscriptions(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await resolveContext(deps, req);
    const { items, lastEvaluatedKey } = await deps.subscriptions.listSubscriptions(context);
    return { statusCode: 200, body: { subscriptions: items, ...(lastEvaluatedKey ? { lastEvaluatedKey } : {}) } };
  });
}

export async function handleDeleteReportSubscription(deps: ReportsHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subscriptionId = requireSubscriptionId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SUBSCRIPTION_DELETE_SCHEMA_ID, req.body);
    const context = await resolveContext(deps, req);
    await deps.subscriptions.deleteSubscription(context, subscriptionId, req.body.expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

// --- Scheduled report run download (D-204 decisions 6-7, implemented fatia 3) ---------------

const DOWNLOAD_PRESIGN_TTL_SECONDS = 5 * 60; // decision 7: short-lived, minted on demand.

function requireRunId(req: HttpRequest): string {
  const runId = req.pathParameters?.["runId"];
  if (!runId) throw new ValidationError("Missing runId path parameter.");
  return runId;
}

/** GET /reports/subscriptions/{subscriptionId}/runs/{runId}/download — never returns file bytes
 * itself, only a freshly minted presigned S3 URL (decision 7's whole point: a long-TTL presign
 * embedded directly in the delivery e-mail is physically invalid past the ~7 day SigV4
 * credential ceiling when signed by a Lambda role, decision 1).
 *
 * RBAC (decision 6): `ADMIN_ROLES` OR `principal.userId` is one of THIS run's real recipients -
 * checked via the `ReportDeliveryAttempt` row the delivery worker wrote for this exact
 * `(subscriptionId, runId, recipientUserId)`, never the mutable/current
 * `ReportSubscription.recipientUserIds` list (which may have moved on since - there is no
 * update route in v1, but this is still the correct authority: "were you actually a recipient
 * of THIS run", not "are you on the subscription's list right now"). */
export async function handleDownloadReportSubscriptionRun(deps: ReportsHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!deps.subscriptionStore || !deps.exportStore) {
      throw new Error("handleDownloadReportSubscriptionRun requires subscriptionStore/exportStore to be wired.");
    }
    const subscriptionId = requireSubscriptionId(req);
    const runId = requireRunId(req);
    const context = await resolveContext(deps, req);
    const tenantId = context.tenant.tenantId;

    const run = await deps.subscriptionStore.get<ReportSubscriptionRun>(reportSubscriptionRunKey(tenantId, subscriptionId, runId));
    if (!run) throw new NotFoundError("ReportSubscriptionRun not found.", { subscriptionId, runId });

    try {
      authorize({ context, action: "reports:subscription-manage", resource: { tenantId } });
    } catch (err) {
      if (!(err instanceof AuthorizationDeniedError)) throw err;
      const attempt = await deps.subscriptionStore.get<ReportDeliveryAttempt>(reportDeliveryAttemptKey(tenantId, subscriptionId, runId, context.principal.userId));
      if (!attempt) {
        auditAuthorizationDenied({ reason: err.reason, action: err.action });
        throw err;
      }
    }

    const downloadUrl = await deps.exportStore.presignDownload({ tenantId, subscriptionId, runId, expiresInSeconds: DOWNLOAD_PRESIGN_TTL_SECONDS });
    return { statusCode: 200, body: { downloadUrl, expiresInSeconds: DOWNLOAD_PRESIGN_TTL_SECONDS } };
  });
}
