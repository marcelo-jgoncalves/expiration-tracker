/**
 * `ExtractedField` persistence port — `ExtractionValidationTaskHandler` (M7 item 7) is the
 * first real writer of this entity. Same PK partition as its parent `ExtractionRun`
 * (`data-model.md` line 107).
 *
 * `commitRunOutcome` is deliberately the ONLY write path this port exposes (no bare
 * put/batch-put) — design §3's transient-artifact-cleanup finding generalizes to the DynamoDB
 * side too: writing the `ExtractedField` rows and transitioning `ExtractionRun.status` to a
 * terminal value must happen atomically, in the SAME `TransactWriteItems` that re-asserts the
 * `Document` row hasn't changed since the caller read it (the TOCTOU close for "descarte por
 * exclusão concorrente" — a concurrent delete/edit of the `Document` between that read and this
 * commit must abort the whole write, never leave `ExtractedField` rows for an item that no
 * longer exists in the state they were computed against).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { ExtractedField } from "../domain/extracted-field.js";

export type CommitRunOutcomeResult = "COMMITTED" | "DOCUMENT_DISCARDED";

export interface CommitRunOutcomeInput {
  fields: readonly ExtractedField[];
  runKey: EntityKey;
  runTenantId: string;
  runExpectedVersion: number;
  runStatus: "COMPLETED" | "FAILED";
  completedAt: string;
  /** The `Document` row read moments earlier by the caller (`DocumentReader.get`) — re-asserted
   * at its observed version inside the same transaction (design §3's TOCTOU close). */
  documentKey: EntityKey;
  documentExpectedVersion: number;
}

export interface ExtractedFieldStore {
  /** Atomically writes every `fields` row (first-time create, `attribute_not_exists` per row —
   * safe to retry only when the whole transaction genuinely never committed, since
   * `TransactWriteItems` is all-or-nothing), transitions the run to a terminal status, and
   * guards against a concurrent `Document` change. Returns `DOCUMENT_DISCARDED` (nothing
   * persisted) when the guard fails — the caller then calls
   * `ExtractionRunStore.updateStatus(..., "DISCARDED", ...)` instead, with zero fields. */
  commitRunOutcome(input: CommitRunOutcomeInput): Promise<CommitRunOutcomeResult>;
}
