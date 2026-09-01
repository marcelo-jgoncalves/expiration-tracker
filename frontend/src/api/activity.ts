/**
 * Admin activity/audit log data access (D-149) - same one-layer convention as items.ts/
 * members.ts: every call site goes through this function, never `apiClient` inline. Real
 * backend path: src/modules/activity/http/activity-handlers.ts, allowlisted in
 * src/modules/bff/domain/proxy-allowlist.ts.
 */
import { apiClient } from "./apiClient.js";
import type { ActivityPageResponse } from "./types.js";

export function fetchActivity(options?: {
  signal?: AbortSignal;
  month?: string;
  resourceType?: string;
  limit?: number;
  cursor?: string;
}): Promise<ActivityPageResponse> {
  const params = new URLSearchParams();
  if (options?.month) params.set("month", options.month);
  if (options?.resourceType) params.set("resourceType", options.resourceType);
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();
  return apiClient.get<ActivityPageResponse>(`/activity${qs ? `?${qs}` : ""}`, { signal: options?.signal });
}
