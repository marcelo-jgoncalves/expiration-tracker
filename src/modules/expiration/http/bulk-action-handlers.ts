/**
 * HTTP handlers for bulk actions (D-206/D-207, Roadmap P1 item 17,
 * `docs/architecture/reviews/bulk-actions-scoping/estado-final-consolidado.md`). Separate
 * module from item-handlers.ts because the request shape is fundamentally different (an
 * array of `{itemId, expectedVersion, ...}` entries, never a single `If-Match` header — a
 * bulk request has no single version to attach to a header) — reuses item-handlers.ts's
 * generic JSON error-mapping/quota/schema-validation helpers rather than duplicating them
 * (unlike export-handler.ts, which needed a genuinely different response shape for CSV).
 *
 * Response is always 200 with a per-item outcome array when the REQUEST itself was
 * processed — a request-level rejection (empty/over-cap batch, missing confirm) is the only
 * case that becomes an HTTP error, thrown by ExpirationService itself as ValidationError
 * before any item is touched.
 */
import { ValidationError } from "../../../shared/errors/app-error.js";
import type { BulkArchiveItemInput, BulkItemOutcome, BulkReassignItemInput } from "../application/expiration-service.js";
import { consumeApiRequestQuota, validateAgainstSchema, withErrorMapping, type ExpirationHttpDeps, type HttpRequest, type HttpResponse } from "./item-handlers.js";

const BULK_REASSIGN_SCHEMA_ID = "https://expiration-tracker/schemas/api/bulk-reassign-items-request.v1.json";
const BULK_ARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/bulk-archive-items-request.v1.json";

interface BulkReassignRequestBody {
  items: BulkReassignItemInput[];
}

interface BulkArchiveRequestBody {
  items: BulkArchiveItemInput[];
  confirm: boolean;
}

export async function handleBulkReassignItems(deps: ExpirationHttpDeps, req: HttpRequest<BulkReassignRequestBody>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(BULK_REASSIGN_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const outcomes: BulkItemOutcome[] = await deps.expiration.bulkReassignItems(context, req.body.items);
    return { statusCode: 200, body: { outcomes } };
  });
}

export async function handleBulkArchiveItems(deps: ExpirationHttpDeps, req: HttpRequest<BulkArchiveRequestBody>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(BULK_ARCHIVE_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const outcomes: BulkItemOutcome[] = await deps.expiration.bulkArchiveItems(context, req.body.items, req.body.confirm);
    return { statusCode: 200, body: { outcomes } };
  });
}
