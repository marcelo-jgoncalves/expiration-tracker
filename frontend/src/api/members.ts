/**
 * Membership/invitation/settings data access (Wave B2B-8/B2B-10) - same one-layer convention
 * as items.ts/subjects.ts: every call site goes through these functions, never `apiClient`
 * inline. Real backend paths: `src/modules/organization/http/{membership,organization-settings}
 * -handlers.ts`, allowlisted in `src/modules/bff/domain/proxy-allowlist.ts`.
 */
import { apiClient } from "./apiClient.js";
import type { InvitationsResponse, MembersResponse, MembershipRole, OrganizationSettingsResponse } from "./types.js";

export function fetchMembers(options?: { signal?: AbortSignal }): Promise<MembersResponse> {
  return apiClient.get<MembersResponse>("/organizations/members", { signal: options?.signal });
}

export function fetchInvitations(options?: { signal?: AbortSignal }): Promise<InvitationsResponse> {
  return apiClient.get<InvitationsResponse>("/organizations/invitations", { signal: options?.signal });
}

export function inviteMember(email: string, role: MembershipRole): Promise<{ invitation: { invitationId: string } }> {
  return apiClient.post("/organizations/members/invite", { email, role });
}

export function revokeInvitation(invitationId: string): Promise<void> {
  return apiClient.post(`/organizations/invitations/${encodeURIComponent(invitationId)}/revoke`, undefined);
}

export function changeMemberRole(userId: string, role: MembershipRole, expectedVersion: number): Promise<void> {
  return apiClient.put(`/organizations/members/${encodeURIComponent(userId)}/role`, { role }, { expectedVersion });
}

export function removeMember(userId: string, expectedVersion: number): Promise<void> {
  return apiClient.delete(`/organizations/members/${encodeURIComponent(userId)}`, { expectedVersion });
}

export function updateOrganizationSettings(input: { displayName?: string; timezone?: string }, expectedVersion: number): Promise<OrganizationSettingsResponse> {
  return apiClient.request<OrganizationSettingsResponse>("/organizations/settings", { method: "PATCH", body: input, expectedVersion });
}
