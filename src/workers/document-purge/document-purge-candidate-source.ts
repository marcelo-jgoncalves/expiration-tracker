/**
 * Narrow port for the DocumentPurgeWorker (W3-06/D-061) — same isolation principle as
 * `reminder/ports/reconciliation-candidate-source.ts`: a GSI6 query surface reachable only by
 * this specific, non-tenant-facing worker. GSI6 is ALL-projected, so a queried row already IS
 * the full `Document`/`DocumentPurgeReceipt` item — no extra `store.get` roundtrip needed.
 */
import type { PurgeCandidate, DocumentPurgeCandidate } from "./purge.js";

export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface DocumentPurgeCandidateSource {
  /** GSI6PK="WORKSTATE#PURGE_PENDING" (global), GSI6SK < now. Mixed `Document`/
   * `DocumentPurgeReceipt` rows, discriminated by `entityType`. */
  listPendingCandidates(input: { before: string; pageSize?: number }): Promise<Page<PurgeCandidate>>;
  /** GSI6PK="WORKSTATE#PURGE_CLAIMED" (global), GSI6SK < now (lease already expired). Only
   * `Document` rows ever reach `CLAIMED` — `DocumentPurgeReceipt` is deleted directly from
   * `PENDING`, see `purge.ts`'s module doc. */
  listExpiredClaims(input: { before: string; pageSize?: number }): Promise<Page<DocumentPurgeCandidate>>;
}
