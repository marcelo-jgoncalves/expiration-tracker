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
  status: "IN_PROGRESS" | "COMPLETED";
  responseRef?: string;
  expiresAt: string;
  createdAt: string;
  completedAt?: string;
}

/** Minimal DynamoDB surface this module needs - implemented against the real
 * DocumentClient in M1's persistence adapters. */
export interface DynamoLike {
  putIfAbsent(item: IdempotencyRecord): Promise<"PUT" | "ALREADY_EXISTS">;
  get(key: { PK: string; SK: string }): Promise<IdempotencyRecord | undefined>;
  update(item: IdempotencyRecord): Promise<void>;
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
}
