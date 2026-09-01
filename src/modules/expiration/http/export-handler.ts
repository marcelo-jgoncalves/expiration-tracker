/**
 * D-123/D-126 (CSV data export). Separate module from item-handlers.ts because the success
 * response shape is fundamentally different (raw CSV body, not the JSON-shaped HttpResponse
 * every other handler returns) — kept out of item-handlers.ts's toResponse()/withErrorMapping
 * pipeline so that pipeline's JSON-only contract is never accidentally weakened for this one
 * caller. See round-3-claude-proposal.md "Resumo final da decisão" for the full mechanism.
 */
import { AppError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { serializeCsvRow } from "../../../shared/csv/csv-export-writer.js";
import type { ExpirationItem } from "../domain/expiration-item.js";
import type { HttpRequest, HttpResponse, ExpirationHttpDeps } from "./item-handlers.js";
import { ValidationError } from "../../../shared/errors/app-error.js";
import { randomUUID } from "node:crypto";
import { logger } from "../../../shared/observability/logger.js";

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

/** 4 MB — round-3 Achado #2's byte guard, measured against the FINAL SERIALIZED CSV (header +
 * every data row + CRLF terminators, post RFC4180-quoting), never the sum of raw field values. */
const EXPORT_MAX_CSV_BYTES = 4 * 1024 * 1024;

const CSV_COLUMNS = [
  "itemId",
  "name",
  "category",
  "description",
  "dueDate",
  "issueDate",
  "periodicity",
  "issuer",
  "number",
  "assigneeUserId",
  "tags",
  "priority",
  "status",
  "createdAt",
  "updatedAt",
] as const;

function toRowFields(item: ExpirationItem): string[] {
  return [
    item.itemId,
    item.name,
    item.category,
    item.description ?? "",
    item.dueDate,
    item.issueDate ?? "",
    item.periodicity ?? "",
    item.issuer ?? "",
    item.number ?? "",
    item.assigneeUserId ?? "",
    (item.tags ?? []).join(";"),
    item.priority ?? "",
    item.status,
    item.createdAt,
    item.updatedAt,
  ];
}

/**
 * Builds the final CSV body, enforcing the 4 MB byte guard row-by-row (round-3 Achado #2) —
 * whichever of the item cap (enforced upstream in ExpirationService.exportItems, Achado #1) or
 * this byte guard is hit first rejects with the same ValidationError shape.
 */
export function buildExportCsv(items: ExpirationItem[]): string {
  let csv = serializeCsvRow([...CSV_COLUMNS]);
  let bytes = Buffer.byteLength(csv, "utf-8");
  for (const item of items) {
    const row = serializeCsvRow(toRowFields(item));
    bytes += Buffer.byteLength(row, "utf-8");
    if (bytes > EXPORT_MAX_CSV_BYTES) {
      throw new ValidationError("Export exceeds 4 MB CSV size cap.", { maxBytes: EXPORT_MAX_CSV_BYTES });
    }
    csv += row;
  }
  return csv;
}

/** Filename is generated ENTIRELY from server-controlled values (tenantId, a timestamp) —
 * never Organization.displayName or any other user-supplied string (Codex round-3
 * non-blocking finding: unsanitized interpolation into Content-Disposition is a header-
 * injection risk). tenantId is a server-generated ULID, never client input. */
function buildExportFilename(tenantId: string, now: () => string): string {
  const timestamp = now().replace(/[:.]/g, "-");
  return `items-export-${tenantId}-${timestamp}.csv`;
}

/** D-149 decisão 5: `exportRequestId` is either inherited from an optional client
 * `Idempotency-Key` header (standard REST pattern, e.g. Stripe — narrow use case is an
 * infra-level retry of the exact same request) or generated fresh per request via
 * `crypto.randomUUID()`. API Gateway lower-cases header names, so only the lowercase key is
 * checked — this handler's `req.headers` always comes from that source (never client-cased). */
function resolveExportRequestId(headers: Record<string, string | undefined> | undefined): string {
  return headers?.["idempotency-key"] || randomUUID();
}

export interface CsvHttpResponse {
  statusCode: number;
  csv: string;
  filename: string;
}

async function consumeApiRequestQuota(deps: ExpirationHttpDeps, context: Awaited<ReturnType<ExpirationHttpDeps["resolver"]["resolve"]>>): Promise<void> {
  await deps.quota.consume({
    tenantId: context.tenant.tenantId,
    quotaType: "API_REQUEST",
    window: "current",
    limit: 100,
    windowSeconds: 60,
  });
}

export async function handleExportItems(
  deps: ExpirationHttpDeps,
  req: HttpRequest,
  now: () => string = () => new Date().toISOString(),
): Promise<HttpResponse | CsvHttpResponse> {
  try {
    const context = await deps.resolver.resolve({
      claims: req.claims,
      requestId: req.requestId,
      correlationId: req.correlationId,
      organizationIdHint: req.headers?.["x-organization-id"],
    });
    await consumeApiRequestQuota(deps, context);
    const items = await deps.expiration.exportItems(context);
    const csv = buildExportCsv(items);
    const filename = buildExportFilename(context.tenant.tenantId, now);

    // D-149 decisão 5: fail-open — the CSV response ships regardless of whether this audit
    // write succeeds. Deliberately placed AFTER the CSV is fully serialized (so a slow/failed
    // audit write can never delay or block the actual export the caller asked for) and BEFORE
    // the response is returned below.
    const exportRequestId = resolveExportRequestId(req.headers);
    try {
      await deps.expiration.recordExportAudit(context, { exportedCount: items.length, exportRequestId });
    } catch (auditErr) {
      logger.error("export-audit-write-failed", {
        tenantId: context.tenant.tenantId,
        correlationId: context.correlationId,
        exportRequestId,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }

    return { statusCode: 200, csv, filename };
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
