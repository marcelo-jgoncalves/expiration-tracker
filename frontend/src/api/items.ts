/**
 * Expiration item data access - every Collection/Detail/Create/Renew call site goes through
 * these functions rather than calling `apiClient` inline, so the real backend paths
 * (src/modules/expiration/http/item-handlers.ts, allowlisted in
 * src/modules/bff/domain/proxy-allowlist.ts) exist in exactly one place.
 */
import { apiClient } from "./apiClient.js";
import type { CreateItemInput, DashboardResponse, ExpirationItemStatus, ItemResponse, RenewItemInput, RenewItemResponse } from "./types.js";

export function fetchDashboard(status: ExpirationItemStatus): Promise<DashboardResponse> {
  return apiClient.get<DashboardResponse>(`/items/dashboard?status=${encodeURIComponent(status)}`);
}

export function fetchItem(itemId: string): Promise<ItemResponse> {
  return apiClient.get<ItemResponse>(`/items/${encodeURIComponent(itemId)}`);
}

export function createItem(input: CreateItemInput, idempotencyKey: string): Promise<ItemResponse> {
  return apiClient.post<ItemResponse>("/items", input, { idempotencyKey });
}

/** `expectedVersion` becomes the `If-Match` header (mission §39: a 409 here is OCC, mapped to
 * ApiError's CONFLICT category by `isConflict()`, never collapsed into a generic failure). */
export function renewItem(itemId: string, input: RenewItemInput, expectedVersion: number, idempotencyKey: string): Promise<RenewItemResponse> {
  return apiClient.post<RenewItemResponse>(`/items/${encodeURIComponent(itemId)}/renew`, input, { idempotencyKey, expectedVersion });
}
