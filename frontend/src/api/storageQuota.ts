/**
 * Storage-quota-scoping (D-2xx) data access - same one-layer convention as members.ts/items.ts:
 * every call site goes through this function, never `apiClient` inline. Real backend path:
 * `src/modules/document-archive/http/document-archive-handlers.ts`'s `handleGetStorageUsage`,
 * allowlisted (GET, no params) in `src/modules/bff/domain/proxy-allowlist.ts`.
 */
import { apiClient } from "./apiClient.js";
import type { StorageUsageResponse } from "./types.js";

export function fetchStorageUsage(options?: { signal?: AbortSignal }): Promise<StorageUsageResponse> {
  return apiClient.get<StorageUsageResponse>("/document-archive/storage-usage", { signal: options?.signal });
}
