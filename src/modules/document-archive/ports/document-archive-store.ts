/**
 * DynamoDB surface the document-archive module needs — same SDK-agnostic port pattern as
 * `src/modules/expiration/ports/expiration-store.ts` (M1's `IdentityStore` precedent):
 * callers inject an implementation, so domain/application logic stays unit-testable without
 * live AWS. Imports the shared TransactWriteItems builders/entry shapes directly from
 * `shared/dynamodb/occ.ts` (never from another module's port) — the exact cross-module
 * ports->ports dependency the 2026-08-19 Engineering Maturity Review moved these out of
 * `expiration-store.ts` to avoid.
 *
 * D-143 Decision 2's `acceptVersion` transaction (up to 10 actions across Document/
 * DocumentVersion/DocumentVersionEvent/Requirement/DocumentRequest) is built by the
 * application layer using these same shared builders — this port only executes whatever
 * `TransactWriteEntry[]` it is handed, it does not know about `acceptVersion` itself.
 */
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export type { EntityKey, TransactWriteEntry };
export { TRANSACTION_CANCELED, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

/**
 * Generic paginated GSI query — this module spans 3 different indexes (GSI1 discriminated by
 * prefix for Document/Requirement-by-status, GSI2 for Document-by-Subject and Request-by-
 * status+responsible, GSI5 for the review queue and version lookup — D-143 Decision 2), so a
 * single `indexName`-parameterized method replaces `ExpirationStore`'s GSI1-only
 * `queryGsi1Page` rather than duplicating three near-identical methods. One real physical
 * `QueryCommand` per call, never an internal accumulate-then-slice loop (the exact cursor-skip
 * bug D-142 found and fixed for `ExpirationStore` — this module inherits that lesson rather
 * than reintroducing it).
 */
export interface IndexPageInput {
  /** The partition-key ATTRIBUTE NAME is derived from `indexName` by the persistence
   * implementation (GSI1 -> GSI1PK, etc.) — never supplied by the caller, so a caller cannot
   * accidentally query GSI2 with a GSI1PK-shaped value. */
  indexName: "GSI1" | "GSI2" | "GSI5";
  partitionKeyValue: string;
  ascending?: boolean;
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}
export interface IndexPage<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}

/** One page of a cross-tenant `Scan` (see `scanSatisfiedRequirements`'s doc comment). */
export interface ScanPage<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface DocumentArchiveStore {
  /** Strongly consistent single-item read — every read this module does gates a mutation
   * (review decisions, accept/reject) or serves an authenticated detail view, never a
   * best-effort dashboard render (D-143 Decision 2 keeps `ConsistentRead` on throughout,
   * same posture D-136 required for session/identity reads). */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  /** PutItem conditioned on attribute_not_exists(PK) AND attribute_not_exists(SK) — true if
   * this call created the item, false if it already existed (used for Document/DocumentVersion
   * creation and for idempotency-record writes outside a larger transaction). */
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  /** PutItem conditioned on a counter still matching `expected` at write time — same
   * lost-update guard `IdentityStore.updateConditional`/`SubjectStore.updateConditional`
   * already established (production bug precedent: `count` is a DynamoDB reserved word,
   * requires `ExpressionAttributeNames`). D-146 (guest access): used by
   * `DocumentArchiveGuestRateLimiter`'s fixed-window counter. */
  updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean>;
  /** Commits every entry atomically; throws an error recognized by `isTransactionCanceled()`
   * if ANY entry's ConditionExpression fails — callers must never assume partial application.
   * This is how `acceptVersion`/`rejectVersion`/`materializeAttempt` (D-143 Decisions 1/2/8)
   * are actually executed. */
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** Query the Document's own partition (Document/DocumentVersion/DocumentFile/
   * DocumentVersionEvent all co-located under `PK=TENANT#<t>#DOCUMENT#<id>`, D-143 Decision 2
   * AP1/AP2/AP9/AP10 — no GSI needed for any of these). */
  queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]>;
  /** Eventually consistent GSI query, one physical page per call. */
  queryIndexPage<T extends EntityKey = Record<string, unknown> & EntityKey>(input: IndexPageInput): Promise<IndexPage<T>>;
  /**
   * Cross-tenant `Scan` filtered to `entityType = "Requirement" AND status = "SATISFIED"` — for
   * the daily reindex worker only (module doc comment on `requirement.ts`: pure time-based
   * SATISFIED -> NOT_SATISFIED drift as `evidenceValidUntil` passes). GSI1's REQSTATUS namespace
   * is tenant-scoped by partition key (`TENANT#<t>#REQSTATUS#<status>`), so it cannot answer
   * "every SATISFIED Requirement across every tenant" without first enumerating tenants — this
   * module has no tenant-enumeration port method, and inventing a new global index for a job
   * that runs once a day is not justified. Same accepted cost tradeoff as
   * `src/workers/tenant-purge/tenant-purge-sweep.ts`'s `scanLifecycleRecords` (DynamoDB bills a
   * Scan for every item read before the filter applies) — explicit here for the same reason it
   * is explicit there, not hidden behind a generic method name. One physical `ScanCommand` per
   * call, paginated by the caller via `lastEvaluatedKey` (same discipline as `queryIndexPage`).
   */
  scanSatisfiedRequirements<T extends EntityKey = Record<string, unknown> & EntityKey>(exclusiveStartKey?: Record<string, unknown>): Promise<ScanPage<T>>;
  /**
   * Cross-tenant `Scan` filtered to `entityType = "DocumentRequestSeries" AND status = "ACTIVE"`
   * — the recurrence materializer worker's "what's due" source (D-143 Decision 8/D-147). Same
   * accepted cost tradeoff as `scanSatisfiedRequirements` (this module still has no
   * tenant-enumeration port method, so a GSI1 query keyed by a specific `TENANT#<t>#...`
   * partition can't answer "every ACTIVE series across every tenant" without one) — a `Scan`
   * filtered at the storage layer, not a full-index accumulate-then-filter in application code.
   * One physical `ScanCommand` per call, paginated by the caller.
   */
  scanActiveSeries<T extends EntityKey = Record<string, unknown> & EntityKey>(exclusiveStartKey?: Record<string, unknown>): Promise<ScanPage<T>>;
}
