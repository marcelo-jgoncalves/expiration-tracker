/**
 * GuestCredentialDelivery — D-226 (`guest-credential-issuance-scoping/estado-final-consolidado.md`,
 * decision central item 5). Lives EXCLUSIVELY in the dedicated `exptrk-<env>-guest-credential-delivery`
 * DynamoDB table — NEVER the main tenant-facing table (`DocumentArchiveStore`'s own table). This is
 * the one row in the whole system that carries the guest's RAW bearer token material (`token`,
 * `selector.secret` — see `request-access-credential.ts`'s `IssuedRequestAccessCredential`) — the
 * main table only ever stores `secretHash`/`selectorHash`, never the raw value, so this MUST NOT be
 * co-located with anything readable by `tenant_facing_read_write_policy_json` (D-146's pepper
 * isolation only means something if the raw material it decrypts/verifies is equally isolated).
 *
 * No GSI — every access pattern is a point lookup by `documentRequestId`+`issuanceGeneration`
 * (`guestCredentialDeliveryKey`), same "no index needed, every read is by exact key" reasoning as
 * `bff-session-table`'s `Session`/`LoginAttempt` rows. TTL (`purgeAfterTtl`) is housekeeping of an
 * abandoned secret, never a recovery mechanism (design's decision 5: "TTL da tabela é housekeeping
 * de segurança... nunca recuperação" — a future delivery worker reads this via the table's own
 * DynamoDB Streams, not by re-deriving it from anywhere else after the TTL window (24h Stream
 * retention) closes).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface GuestCredentialDeliveryRecord extends EntityKey {
  SK: "DELIVERY";
  entityType: "GuestCredentialDelivery";
  tenantId: string;
  subjectId: string;
  documentRequestId: string;
  requirementId: string;
  issuanceGeneration: number;
  /** Full `selector.secret` token — the raw material a delivery channel (email/SMS/etc, future
   * worker) would embed in the link sent to the external party. Exists ONLY here. */
  token: string;
  selectorHash: string;
  expiresAt: string;
  /** DynamoDB TTL attribute (epoch seconds) — same D-047/D-048 lesson every other TTL'd entity in
   * this codebase documents: only read by application code, never itself a delivery trigger. */
  purgeAfterTtl: number;
  createdAt: string;
}

export function guestCredentialDeliveryKey(documentRequestId: string, issuanceGeneration: number): { PK: string; SK: "DELIVERY" } {
  return { PK: `DOCREQUEST#${documentRequestId}#GEN#${issuanceGeneration}`, SK: "DELIVERY" };
}
