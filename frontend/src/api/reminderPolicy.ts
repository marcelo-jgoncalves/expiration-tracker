/**
 * ReminderPolicy data access (A06, Block 2 D-258) - mirrors documents.ts's convention: every
 * call goes through here, matching the real backend paths allowlisted in
 * src/modules/bff/domain/proxy-allowlist.ts. `getPolicyForItem` uses the item->policy
 * discovery route (D-258); create/update/disable use the policyId-addressed routes that
 * already existed (`src/modules/reminder/http/policy-handlers.ts`).
 */
import { apiClient } from "./apiClient.js";
import type { ItemReminderPolicyResponse, PolicyResponse, PutPolicyInput } from "./types.js";

export function getPolicyForItem(itemId: string, options?: { signal?: AbortSignal }): Promise<ItemReminderPolicyResponse> {
  return apiClient.get<ItemReminderPolicyResponse>(`/items/${encodeURIComponent(itemId)}/reminder-policy`, { signal: options?.signal });
}

export function createPolicy(input: PutPolicyInput, idempotencyKey: string): Promise<PolicyResponse> {
  return apiClient.post<PolicyResponse>("/reminders/policies", input, { idempotencyKey });
}

export function updatePolicy(policyId: string, input: PutPolicyInput, expectedVersion: number): Promise<PolicyResponse> {
  return apiClient.put<PolicyResponse>(`/reminders/policies/${encodeURIComponent(policyId)}`, input, { expectedVersion });
}
