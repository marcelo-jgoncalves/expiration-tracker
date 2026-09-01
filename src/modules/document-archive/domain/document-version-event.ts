/**
 * DocumentVersionEvent — D-143 Decision 3. Append-only audit log, one item per real state
 * transition, written in the SAME transaction as the `DocumentVersion.state` write it records.
 * Formally distinct from `src/shared/outbox/outbox.ts`'s `OutboxEvent` (that mechanism is for
 * async publication to a queue/consumer; this is a synchronously-consultable history under the
 * Document's own partition, AP10) — the Rodada 2 proposal conflated the two, a real error the
 * Rodada 3 protocol round corrected.
 *
 * `DocumentVersion.state` remains the ONLY mutable source of truth (never this log) — this
 * exists purely so a compressed internal auto-accept flow (commitUpload+claimReview+
 * acceptVersion collapsed into one transaction, C3) still leaves an observable, ordered trail
 * proving RECEIVED and UNDER_REVIEW were traversed, even though the Version item itself only
 * ever shows its terminal `ACCEPTED` state.
 */
import type { DocumentVersionState } from "./document-version.js";

export type DocumentVersionEventType = "RECEIVED" | "CLAIMED" | "CLAIM_EXPIRED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "WITHDRAWN" | "FILE_REMOVED_INFECTED";

export interface DocumentVersionEvent {
  PK: string;
  SK: string; // `VERSION#<seq>#EVENT#<ULID>` — AP10, chronological via ULID, distinct from the
  // idempotency record's `EVENT#<clientRequestToken>` key (never the same key space).
  entityType: "DocumentVersionEvent";
  tenantId: string;
  documentId: string;
  versionId: string;
  type: DocumentVersionEventType;
  fromState?: DocumentVersionState;
  toState: DocumentVersionState;
  actor: string;
  occurredAt: string;
}

/** Idempotency record for a mutating command — distinct item type and key space from
 * `DocumentVersionEvent` above (D-143 Decision 2/Bloqueador 4-5). Keyed by the caller-supplied
 * `clientRequestToken`, never a ULID. A replay whose `payloadHash` matches responds with the
 * persisted `resultSnapshot` verbatim — never a fresh read of current state, which may have
 * since moved on (e.g. an accepted version later superseded by a renewal). */
export interface IdempotencyRecord<TResult = unknown> {
  PK: string;
  SK: string; // `VERSION#<seq>#IDEMPOTENCY#<clientRequestToken>` — deliberately a different SK
  // prefix than `#EVENT#<ULID>` (never `#EVENT#<token>`), so no caller-supplied token can ever
  // collide with the ULID key space of a real audit event.
  entityType: "IdempotencyRecord";
  tenantId: string;
  payloadHash: string;
  resultSnapshot: TResult;
  createdAt: string;
}

export function documentVersionEventKey(tenantId: string, documentId: string, seq: number, ulid: string): { PK: string; SK: string } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `VERSION#${String(seq).padStart(6, "0")}#EVENT#${ulid}` };
}

export function idempotencyRecordKey(tenantId: string, documentId: string, seq: number, clientRequestToken: string): { PK: string; SK: string } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `VERSION#${String(seq).padStart(6, "0")}#IDEMPOTENCY#${clientRequestToken}` };
}
