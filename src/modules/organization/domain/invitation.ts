/**
 * Invitation — Multi-User B2B Wave B2B-8 (docs/architecture/multi-user-b2b-physical-model.md
 * §7, `APPROVED` D-086; escopo final `APPROVED` D-099, docs/architecture/multi-user-b2b-wave-
 * b2b8-scope.md). Mesma partição do `Organization`/`Membership`
 * (`PK=TENANT#<organizationId>#ORG#<organizationId>`), `SK=INVITATION#<invitationId>`.
 *
 * `emailNormalized` usa a MESMA função de normalização já usada por `GlobalUser`/
 * `IdentityMapping` (physical model §1) — nunca reimplementada aqui.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { MembershipRole } from "./membership.js";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation extends EntityKey {
  SK: string; // INVITATION#<invitationId>
  entityType: "Invitation";
  invitationId: string;
  organizationId: string;
  emailNormalized: string;
  role: MembershipRole;
  status: InvitationStatus;
  tokenPointerId: string;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  version: number;
}

export function invitationKey(organizationId: string, invitationId: string): { PK: string; SK: string } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: `INVITATION#${invitationId}` };
}

/** Dedup pointer PENDING por (org, e-mail) — tenant-scoped por desvio deliberado (physical
 * model §7: `organizationId` já é conhecido no momento de criar o convite). Um `Invitation`
 * PENDING por (org, e-mail) por vez — criar um novo enquanto este existe vira reenvio/rotação
 * do convite existente, nunca um segundo `Invitation` PENDING. */
export interface InvitationDedupPointer extends EntityKey {
  SK: string; // INVITE_DEDUP#<emailNormalized>
  entityType: "InvitationDedupPointer";
  invitationId: string;
  organizationId: string;
  emailNormalized: string;
  expiresAt: string;
}

export function invitationDedupKey(organizationId: string, emailNormalized: string): { PK: string; SK: string } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: `INVITE_DEDUP#${emailNormalized}` };
}
