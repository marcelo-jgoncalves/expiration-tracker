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
import { AppError, AuthorizationError, toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { serializeCsvRow } from "../../../shared/csv/csv-export-writer.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { ExpirationItem } from "../../expiration/domain/expiration-item.js";
import { ReportsService, type RequirementReportRow } from "../application/reports-service.js";

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

export interface HttpRequest {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
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
}

const EXPIRATION_ITEM_CSV_COLUMNS = ["itemId", "name", "category", "dueDate", "assigneeUserId", "tags", "status", "renewedFromId", "updatedAt"] as const;

function expirationItemRowFields(item: ExpirationItem): string[] {
  return [item.itemId, item.name, item.category, item.dueDate, item.assigneeUserId ?? "", item.tags.join(";"), item.status, item.renewedFromId ?? "", item.updatedAt];
}

function buildExpirationItemCsv(items: ExpirationItem[]): string {
  let csv = serializeCsvRow([...EXPIRATION_ITEM_CSV_COLUMNS]);
  for (const item of items) csv += serializeCsvRow(expirationItemRowFields(item));
  return csv;
}

const REQUIREMENT_CSV_COLUMNS = ["requirementId", "subjectId", "subjectDisplayName", "name", "status", "assigneeUserId", "evidenceValidUntil", "updatedAt"] as const;

function requirementRowFields(row: RequirementReportRow): string[] {
  const r = row.requirement;
  return [r.requirementId, r.subjectId, row.subjectDisplayName ?? "", r.name, r.status, r.assigneeUserId ?? "", r.evidenceValidUntil ?? "", r.updatedAt];
}

function buildRequirementCsv(rows: RequirementReportRow[]): string {
  let csv = serializeCsvRow([...REQUIREMENT_CSV_COLUMNS]);
  for (const row of rows) csv += serializeCsvRow(requirementRowFields(row));
  return csv;
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
