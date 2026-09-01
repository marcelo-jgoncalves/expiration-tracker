/**
 * Expiration item data access - every Collection/Detail/Create/Renew call site goes through
 * these functions rather than calling `apiClient` inline, so the real backend paths
 * (src/modules/expiration/http/item-handlers.ts, allowlisted in
 * src/modules/bff/domain/proxy-allowlist.ts) exist in exactly one place.
 */
import { apiClient } from "./apiClient.js";
import type { CreateItemInput, DashboardResponse, ExpirationItemStatus, ItemResponse, RenewItemInput, RenewItemResponse } from "./types.js";

/** D-136/D-E: `limit`/`cursor` are optional - omitting both preserves the exact request shape
 * every existing call site already sends (server applies its own default limit either way,
 * never an unbounded query regardless of what the caller passes). */
export function fetchDashboard(
  status: ExpirationItemStatus,
  options?: { signal?: AbortSignal; limit?: number; cursor?: string },
): Promise<DashboardResponse> {
  const params = new URLSearchParams({ status });
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  return apiClient.get<DashboardResponse>(`/items/dashboard?${params.toString()}`, { signal: options?.signal });
}

export function fetchItem(itemId: string, options?: { signal?: AbortSignal }): Promise<ItemResponse> {
  return apiClient.get<ItemResponse>(`/items/${encodeURIComponent(itemId)}`, { signal: options?.signal });
}

export function createItem(input: CreateItemInput, idempotencyKey: string): Promise<ItemResponse> {
  return apiClient.post<ItemResponse>("/items", input, { idempotencyKey });
}

/** `expectedVersion` becomes the `If-Match` header (mission §39: a 409 here is OCC, mapped to
 * ApiError's CONFLICT category by `isConflict()`, never collapsed into a generic failure). */
export function renewItem(itemId: string, input: RenewItemInput, expectedVersion: number, idempotencyKey: string): Promise<RenewItemResponse> {
  return apiClient.post<RenewItemResponse>(`/items/${encodeURIComponent(itemId)}/renew`, input, { idempotencyKey, expectedVersion });
}
