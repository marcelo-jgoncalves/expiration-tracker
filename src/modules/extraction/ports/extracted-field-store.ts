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
  /** Present only when the run auto-confirmed a field that maps to a known `ExpirationItem`
   * attribute (W2-01-DECISION — schema v1: `expirationDate` -> `dueDate`). When present, the
   * item is updated with OCC in the SAME `TransactWriteItems` as the field rows and the run
   * transition: the auto-confirm outcome either lands whole or not at all, exactly like the
   * manual `confirmField` path. Absent means the transaction never touches the item at all
   * (nothing to assert — unlike `confirmField`, this operation has no design requirement to
   * pin the item's version when it has no item-side effect). */
  itemUpdate?: CommitItemUpdate;
}

/** The `ExpirationItem` leg of a `commitRunOutcome` transaction. */
export interface CommitItemUpdate {
  key: EntityKey;
  tenantId: string;
  expectedVersion: number;
  set: Record<string, unknown>;
}

export interface ExtractedFieldStore {
  /** Atomically writes every `fields` row (first-time create, `attribute_not_exists` per row —
   * safe to retry only when the whole transaction genuinely never committed, since
   * `TransactWriteItems` is all-or-nothing), transitions the run to a terminal status, and
   * guards against a concurrent `Document` change. Returns `DOCUMENT_DISCARDED` (nothing
   * persisted) when the guard fails — the caller then calls
   * `ExtractionRunStore.updateStatus(..., "DISCARDED", ...)` instead, with zero fields.
   *
   * When `input.itemUpdate` is present, a versioned `Update` of the `ExpirationItem` joins the
   * same transaction — the pipeline's auto-confirm write of `dueDate`. A stale item version is
   * therefore reported through the same `DOCUMENT_DISCARDED` channel as the other guards (the
   * adapter deliberately does not parse per-entry cancellation reasons), and the caller's
   * fallback — mark the run `DISCARDED`, persist nothing — stays safe. */
  commitRunOutcome(input: CommitRunOutcomeInput): Promise<CommitRunOutcomeResult>;

  /** M7 item 8 (§1.7): plain, eventually-consistent read of one `ExtractedField` row — the
   * confirm/reject HTTP routes need the field's current `state`/`version` before deciding
   * anything. */
  get(key: EntityKey): Promise<ExtractedField | undefined>;

  /** `POST .../fields/{fieldName}/confirm` (§1.7): one `TransactWriteItems` —
   * `ExtractedField.state` -> `CONFIRMED` (+ `confirmedValue`), `ConditionCheck`s pinning
   * `ExtractionRun`/`Document` at their observed versions (neither is modified), and,
   * when `itemUpdate` is supplied (only when the field maps to a known `ExpirationItem`
   * attribute — schema v1 only has `expirationDate` -> `dueDate`), a versioned `Update` of the
   * `ExpirationItem` row; otherwise a `ConditionCheck` pinning the item's version instead (the
   * design still requires `expectedItemVersion` on every confirm, even for fields with no
   * item-side effect yet). All 4 entities succeed or none do. Returns `VERSION_CONFLICT` — never
   * throws — when any single `ConditionCheck`/conditional `Update` fails, so the caller can map
   * it to HTTP 409 without inspecting SDK-specific cancellation reasons. */
  confirmField(input: ConfirmFieldInput): Promise<FieldTransitionResult>;

  /** `POST .../fields/{fieldName}/reject` (§1.7): `ExtractedField.state` -> `REJECTED` (+
   * optional `correctionReason`) plus `ConditionCheck`s pinning `ExtractionRun`/`Document` —
   * NEVER touches `ExpirationItem` (no `expectedItemVersion` in the reject contract at all). */
  rejectField(input: RejectFieldInput): Promise<FieldTransitionResult>;
}

export type FieldTransitionResult = "COMMITTED" | "VERSION_CONFLICT";

export interface ConfirmFieldInput {
  fieldKey: EntityKey;
  fieldTenantId: string;
  fieldExpectedVersion: number;
  confirmedValue: string;
  runKey: EntityKey;
  runExpectedVersion: number;
  documentKey: EntityKey;
  documentExpectedVersion: number;
  itemKey: EntityKey;
  itemTenantId: string;
  itemExpectedVersion: number;
  /** Present only when the field maps to a known `ExpirationItem` attribute — see
   * `confirmField` doc above. */
  itemUpdate?: Record<string, unknown>;
  now: string;
}

export interface RejectFieldInput {
  fieldKey: EntityKey;
  fieldTenantId: string;
  fieldExpectedVersion: number;
  correctionReason?: string;
  runKey: EntityKey;
  runExpectedVersion: number;
  documentKey: EntityKey;
  documentExpectedVersion: number;
  now: string;
}
