/**
 * Idempotency helper - implementation-blueprint.md #5.1 (IdempotencyPort) + data-model.md
 * §4 (per-operation idempotency key table). Materializes keys with
 * `PutItem attribute_not_exists(PK)` as required by data-model.md §4.
 *
 * Like occ.ts, this stays SDK-client-agnostic: callers inject a minimal `DynamoLike` port
 * (put/get) so the module is unit-testable in M0 without real DynamoDB, and M1 supplies
 * the real DocumentClient-backed adapter once the Idempotency table exists.
 */
import { InternalError } from "../errors/app-error.js";
import { isTransactionCanceled, type TransactWriteEntry } from "../dynamodb/occ.js";

export type IdempotencyResult = "ACQUIRED" | "COMPLETED_SAME_REQUEST";

export interface IdempotencyBeginInput {
  tenantId: string;
  operation: string;
  key: string;
  requestHash: string;
  expiresAt: string;
}

export interface IdempotencyCompleteInput {
  tenantId: string;
  operation: string;
  key: string;
  responseRef?: string;
}

interface IdempotencyRecord {
  PK: string;
  SK: string;
  entityType: "IdempotencyRecord";
  tenantId: string;
  operation: string;
  requestHash: string;
  status: "IN_PROGRESS" | "COMPLETED" | "ABORTED";
  responseRef?: string;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
}

export interface IdempotencyAbortInput {
  tenantId: string;
  operation: string;
  key: string;
}

/** Minimal DynamoDB surface this module needs - implemented against the real
 * DocumentClient in M1's persistence adapters. */
export interface DynamoLike {
  putIfAbsent(item: IdempotencyRecord): Promise<"PUT" | "ALREADY_EXISTS">;
  get(key: { PK: string; SK: string }): Promise<IdempotencyRecord | undefined>;
  update(item: IdempotencyRecord): Promise<void>;
  /**
   * Conditional replace: applies `item` only if the STORED record's status is still exactly
   * `expectedStatus` at write time. Real Codex Round B finding: begin()'s ABORTED-reacquisition
   * branch used to do a plain get() then unconditional update(), so two concurrent retries
   * could both observe ABORTED and both "win" the reacquisition, double-executing the guarded
   * operation - the exact failure mode this whole module exists to prevent. The identical
   * primitive also closes the same class of race in abort()'s IN_PROGRESS->ABORTED transition
   * (never flagged by Round B, but structurally the same TOCTOU window - a concurrent
   * complete() landing between abort()'s get() and update() would otherwise be silently
   * clobbered back to ABORTED). Returns false if the condition failed (another caller already
   * transitioned it first) - see transitionIdempotencyStatus() below for the shared
   * transactWrite-based implementation every adapter reuses.
   */
  transitionIfStatus(item: IdempotencyRecord, expectedStatus: IdempotencyRecord["status"]): Promise<boolean>;
}

export interface TransactWriteCapableStore {
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}

/**
 * Shared DynamoLike.transitionIfStatus implementation, built from any store already exposing
 * transactWrite (every module wiring up an IdempotencyStore - expiration/document/import -
 * already has one for its own aggregate writes) - a single-entry conditional TransactWriteItems,
 * reused identically rather than each module hand-rolling the same ConditionExpression.
 */
export function transitionIdempotencyStatus(
  store: TransactWriteCapableStore,
  tableName: string,
  item: IdempotencyRecord,
  expectedStatus: IdempotencyRecord["status"],
): Promise<boolean> {
  const names: Record<string, string> = { "#status": "status", "#requestHash": "requestHash", "#responseRef": "responseRef", "#completedAt": "completedAt" };
  const values: Record<string, unknown> = { ":expected": expectedStatus, ":status": item.status, ":requestHash": item.requestHash };
  const setClauses = ["#status = :status", "#requestHash = :requestHash"];
  const removeClauses: string[] = [];

  if (item.responseRef !== undefined) {
    values[":responseRef"] = item.responseRef;
    setClauses.push("#responseRef = :responseRef");
  } else {
    removeClauses.push("#responseRef");
  }
  if (item.completedAt !== undefined) {
    values[":completedAt"] = item.completedAt;
    setClauses.push("#completedAt = :completedAt");
  } else {
    removeClauses.push("#completedAt");
  }

  const entries: TransactWriteEntry[] = [
    {
      Update: {
        TableName: tableName,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: removeClauses.length > 0 ? `SET ${setClauses.join(", ")} REMOVE ${removeClauses.join(", ")}` : `SET ${setClauses.join(", ")}`,
        ConditionExpression: "#status = :expected",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    },
  ];

  return store
    .transactWrite(entries)
    .then(() => true)
    .catch((err) => {
      if (isTransactionCanceled(err)) return false;
      throw err;
    });
}

export function buildIdempotencyKey(tableName: string, tenantId: string, operation: string, key: string) {
  return {
    tableName,
    PK: `TENANT#${tenantId}#IDEMPOTENCY#${operation}`,
    SK: `KEY#${key}`,
  };
}

export class ConcurrentOperationError extends InternalError {
  constructor(operation: string, key: string) {
    super(`Idempotency key already in progress for a different request: ${operation}/${key}`, {
      operation,
      key,
    });
    this.name = "ConcurrentOperationError";
  }
}

export class IdempotencyStore {
  constructor(
    private readonly client: DynamoLike,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * begin() implements IdempotencyPort.begin from implementation-blueprint.md #5.1:
   * - first caller for a key: ACQUIRED, proceed with the operation.
   * - a caller retrying the exact same request (same requestHash) after completion:
   *   COMPLETED_SAME_REQUEST, safe to return the cached result.
   * - a caller with a different requestHash for the same key while IN_PROGRESS or
   *   COMPLETED with a different hash: this is a genuine conflict (key reuse across
   *   different logical requests), surfaced as ConcurrentOperationError.
   */
  async begin(input: IdempotencyBeginInput): Promise<IdempotencyResult> {
    const { PK, SK } = buildIdempotencyKey(this.tableName, input.tenantId, input.operation, input.key);
    const record: IdempotencyRecord = {
      PK,
      SK,
      entityType: "IdempotencyRecord",
      tenantId: input.tenantId,
      operation: input.operation,
      requestHash: input.requestHash,
      status: "IN_PROGRESS",
      expiresAt: input.expiresAt,
      createdAt: this.now(),
    };

    const putResult = await this.client.putIfAbsent(record);
    if (putResult === "PUT") {
      return "ACQUIRED";
    }

    const existing = await this.client.get({ PK, SK });
    if (!existing) {
      // Extremely unlikely race (deleted between put-conflict and get) - treat as acquirable.
      return "ACQUIRED";
    }

    if (existing.status === "ABORTED") {
      // The previous holder of this key never completed its guarded operation - it failed for
      // a reason unrelated to "this exact request already succeeded" (e.g. an OCC version
      // conflict on the aggregate write, ExpirationService.renewItem calling abort() in its
      // catch block) and explicitly released the lock via abort(). The aborted record's stale
      // requestHash is irrelevant here - unlike a genuine key-reuse conflict (below), there is
      // no cached success this new attempt could collide with, so it would be safe to acquire
      // fresh regardless of whether the new hash matches the aborted one - PROVIDED the
      // reacquisition itself is atomic. A plain get()-then-update() here (as this used to do)
      // is a real TOCTOU race: two concurrent retries can both read ABORTED and both then
      // "win" an unconditional update(), double-executing the guarded operation - so
      // transitionIfStatus() below is a conditional write that only one concurrent caller can
      // win.
      const reacquired = await this.client.transitionIfStatus(
        { ...existing, status: "IN_PROGRESS", requestHash: input.requestHash, responseRef: undefined, completedAt: undefined },
        "ABORTED",
      );
      if (reacquired) return "ACQUIRED";
      // Lost the race - another concurrent caller reacquired (or has since completed) this key
      // first. Treated the same as any other concurrent collision below: the caller retries
      // later rather than risk double-executing the guarded operation.
      throw new ConcurrentOperationError(input.operation, input.key);
    }

    if (existing.requestHash !== input.requestHash) {
      throw new ConcurrentOperationError(input.operation, input.key);
    }

    if (existing.status === "COMPLETED") {
      return "COMPLETED_SAME_REQUEST";
    }

    // Same request hash, still IN_PROGRESS (e.g. concurrent SQS redelivery of the exact
    // same message before the first attempt finished). Caller should treat this as a
    // transient collision and retry later, not double-execute the side effect.
    throw new ConcurrentOperationError(input.operation, input.key);
  }

  async complete(input: IdempotencyCompleteInput): Promise<void> {
    const { PK, SK } = buildIdempotencyKey(this.tableName, input.tenantId, input.operation, input.key);
    const existing = await this.client.get({ PK, SK });
    if (!existing) {
      throw new InternalError(`Cannot complete unknown idempotency record: ${input.operation}/${input.key}`);
    }
    await this.client.update({
      ...existing,
      status: "COMPLETED",
      responseRef: input.responseRef,
      completedAt: this.now(),
    });
  }

  /**
   * Releases a lock this caller acquired via begin() but never completed, because the
   * guarded operation itself failed (mission's "idempotency liveness residual", docs/frontend
   * core-expiration-vertical-slice.md - discovered building Renew's OCC-conflict path: without
   * this, a version conflict on the aggregate write would leave the key permanently
   * IN_PROGRESS, and every retry - even with a freshly re-fetched expectedVersion - would hit
   * ConcurrentOperationError forever, since begin() never re-acquires an IN_PROGRESS record).
   * A no-op if the record is missing or already COMPLETED (a real cached success must never be
   * discarded just because a caller mistakenly aborts after the fact) - the transitionIfStatus()
   * condition (expects IN_PROGRESS) makes this atomic against a concurrent complete(), too: if
   * complete() lands between this method's get() and its conditional write, the write loses the
   * race and simply returns without effect, rather than clobbering a legitimate success back to
   * ABORTED.
   */
  async abort(input: IdempotencyAbortInput): Promise<void> {
    const { PK, SK } = buildIdempotencyKey(this.tableName, input.tenantId, input.operation, input.key);
    const existing = await this.client.get({ PK, SK });
    if (!existing || existing.status !== "IN_PROGRESS") return;
    await this.client.transitionIfStatus({ ...existing, status: "ABORTED" }, "IN_PROGRESS");
  }
}
