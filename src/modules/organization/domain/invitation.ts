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
  /** MaintenanceDueIndex pointer (D-179/slice 2) — unlike Membership's removal-time write, the
   * PENDING branch's due date (`expiresAt + 30 days`) is already fully known at creation (D-179
   * §2's "writer of the entity writes the pointer at the real transition" reused literally:
   * creation IS that transition for a PENDING row, there is no later discrete event to hang it
   * on), so `create-invitation.ts` stamps this at Put time, not just at revoke. `revoke-
   * invitation.ts` overwrites it (revocation can move the due date earlier than the original
   * PENDING expiry). `accept-invitation.ts` clears it (ACCEPTED is never a candidate). Sparse:
   * absent only for a never-eligible status (ACCEPTED/EXPIRED). */
  GSI8PK?: string;
  GSI8SK?: string;
  /** Same D-179 §8 poison-record retry counter as `Membership.maintenanceAttemptCount` — observed
   * on revalidation, drives capped exponential backoff / DLQ#INVITATION_PURGE quarantine. */
  maintenanceAttemptCount?: number;
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

/** D-155's "encerramento + 30 dias" retention window, now also the source of
 * `deriveInvitationMaintenanceDue()`'s due date (D-179 slice 2) — same constant shape as
 * `MEMBERSHIP_RETENTION_DAYS`. */
export const INVITATION_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** GSI8 (MaintenanceDueIndex, D-179) namespace this worker owns — the ONLY value any
 * invitation-purge-scoped IAM policy's `dynamodb:LeadingKeys` condition may reference
 * (`infra/modules/dynamo-table/main.tf`), alongside the DLQ counterpart. */
export const INVITATION_PURGE_WORK_TYPE = "INVITATION_PURGE";

export interface MaintenanceDue {
  dueAtIso: string;
}

/**
 * Pure `deriveMaintenanceDue()` for `Invitation` (D-179 §2/slice 2) — single source of truth for
 * "when does this row become an invitation-purge candidate", reused by the same 3 consumers as
 * `deriveMembershipMaintenanceDue()`: the writer(s) of the GSI8 pointer at the real transition(s)
 * (`create-invitation.ts`/`revoke-invitation.ts`/`accept-invitation.ts`), the backfill script
 * (`scripts/backfill-gsi8-invitation-purge.ts`), and the worker's own revalidation step
 * (`invitation-purge/purge.ts`).
 *
 * Two branches, same as the pre-GSI8 `terminalTimestamp()`/`isPurgeEligibleByTermination()` pair
 * this replaces:
 *   - `REVOKED` with `revokedAt` — due at `revokedAt + RETENTION_DAYS`.
 *   - `PENDING` — due at `expiresAt + RETENTION_DAYS`, ALWAYS computable (unlike Membership's
 *     REMOVED branch, `expiresAt` is set at creation and never absent for a PENDING row) — this is
 *     exactly why the GSI8 pointer for this branch is written at creation time, not at a later
 *     transition: the due date is already fully known then, and there is no other discrete event
 *     ("became terminal") to hang the write on, since a PENDING row's eventual expiry is pure time
 *     passing, never a state-changing write.
 * `undefined` for `ACCEPTED`/`EXPIRED` (never a real candidate) or a malformed REVOKED row missing
 * `revokedAt` (fail-closed defense in depth, same posture as Membership's pre-D-158 REMOVED row).
 */
export function deriveInvitationMaintenanceDue(invitation: Pick<Invitation, "status" | "revokedAt" | "expiresAt">): MaintenanceDue | undefined {
  if (invitation.status === "REVOKED") {
    if (!invitation.revokedAt) return undefined;
    return { dueAtIso: new Date(Date.parse(invitation.revokedAt) + INVITATION_RETENTION_DAYS * MS_PER_DAY).toISOString() };
  }
  if (invitation.status === "PENDING") {
    return { dueAtIso: new Date(Date.parse(invitation.expiresAt) + INVITATION_RETENTION_DAYS * MS_PER_DAY).toISOString() };
  }
  return undefined;
}

/** `GSI8PK=WORK#INVITATION_PURGE` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<invitationId>` (D-179's
 * exact key spec, same shape as `membershipGsi8Keys()`). */
export function invitationGsi8Keys(input: { dueAtIso: string; tenantId: string; invitationId: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${INVITATION_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.invitationId}`,
  };
}
