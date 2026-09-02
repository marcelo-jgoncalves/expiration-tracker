/**
 * Real DynamoDB adapter for IdentityStore (M3.5). Thin translation to
 * DynamoDBDocumentClient commands - no OCC/idempotency logic lives here, that's already
 * built by shared/dynamodb/occ.ts and shared/idempotency/idempotency.ts; this class only
 * executes the commands those builders produce (for `update`) and issues plain
 * Get/Put for the rest.
 */
import { GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EntityKey, IdentityStore, TelemetryIncrementInput, TransactWriteEntry } from "../ports/identity-store.js";
import { isConditionalCheckFailed, mapDynamoError } from "../../../shared/dynamodb/sdk-errors.js";

export class DynamoDbIdentityStore implements IdentityStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined> {
    try {
      const result = await this.client.send(
        new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }),
      );
      return result.Item as T | undefined;
    } catch (err) {
      throw mapDynamoError(err, "IdentityStore.get");
    }
  }

  async putIfAbsent<T extends EntityKey>(item: T): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "IdentityStore.putIfAbsent");
    }
  }

  /** Unconditional overwrite - matches the fake's semantics (non-OCC bookkeeping writes only). */
  async update<T extends EntityKey>(item: T): Promise<void> {
    try {
      await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    } catch (err) {
      throw mapDynamoError(err, "IdentityStore.update");
    }
  }

  async updateConditional<T extends EntityKey>(
    item: T,
    expected: { count: number; resetAt: string },
  ): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          // Real production bug found via a live smoke test against
          // exptrk-dev-notifications-handler (2026-08-21): `count` is a DynamoDB reserved
          // word (https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html)
          // - using it as a bare attribute name in a ConditionExpression, instead of through
          // an ExpressionAttributeNames placeholder, makes every real DynamoDB call fail with
          // ValidationException. Never caught by any test because the in-memory
          // IdentityStore fake (test/unit/identity/in-memory-store.ts) doesn't parse
          // condition expressions the way real DynamoDB does - this path was never actually
          // exercised against real DynamoDB before this session's real deploy.
          ConditionExpression: "#count = :expectedCount AND resetAt = :expectedResetAt",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: {
            ":expectedCount": expected.count,
            ":expectedResetAt": expected.resetAt,
          },
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw mapDynamoError(err, "IdentityStore.updateConditional");
    }
  }

  /**
   * `EphemeralTelemetryMutation` lane (D-136 D-D) — single `ADD`-only `UpdateItem`, no
   * `ConditionExpression`, no prior `Get`. `resetAt`/`purgeAfterTtl` are set via `if_not_exists`
   * so a losing concurrent writer in the same window never rewinds them once the first writer in
   * that bucket establishes the window's true end - only `count` is unconditionally additive.
   */
  async incrementTelemetryCounter(input: TelemetryIncrementInput): Promise<{ count: number }> {
    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: input.key,
          UpdateExpression:
            "ADD #count :incr SET entityType = :entityType, tenantId = :tenantId, quotaType = :quotaType, windowSeconds = :windowSeconds, resetAt = if_not_exists(resetAt, :resetAt), purgeAfterTtl = if_not_exists(purgeAfterTtl, :purgeAfterTtl), GSI8PK = if_not_exists(GSI8PK, :gsi8pk), GSI8SK = if_not_exists(GSI8SK, :gsi8sk)",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: {
            ":incr": 1,
            ":entityType": "EphemeralTelemetryMutation",
            ":tenantId": input.tenantId,
            ":quotaType": input.quotaType,
            ":windowSeconds": input.windowSeconds,
            ":resetAt": input.resetAt,
            ":purgeAfterTtl": input.purgeAfterTtl,
            ":gsi8pk": input.gsi8.GSI8PK,
            ":gsi8sk": input.gsi8.GSI8SK,
          },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      const count = (result.Attributes as { count?: number } | undefined)?.count;
      if (typeof count !== "number") {
        throw new Error("incrementTelemetryCounter: DynamoDB did not return the updated count.");
      }
      return { count };
    } catch (err) {
      throw mapDynamoError(err, "IdentityStore.incrementTelemetryCounter");
    }
  }

  // TransactionCanceledException must reach the caller as-is (isTransactionCanceled() is how
  // callers distinguish OCC/lifecycle-fence conflicts from other failures) - never wrapped by
  // mapDynamoError, same discipline as DynamoDbExpirationStore.transactWrite.
  async transactWrite(entries: TransactWriteEntry[]): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"],
      }),
    );
  }
}
