/**
 * Optimistic concurrency control helper - implementation-blueprint.md #5.2 / M0 deliverable.
 *
 * M0 ships no tables/Lambdas yet (that's M1+), so this module only builds the DynamoDB
 * command *parameters* for OCC-safe writes; it does not depend on @aws-sdk/client-dynamodb
 * so it stays testable without AWS credentials/mocks. M1 wires these builders into the
 * actual DocumentClient calls once tables exist.
 */

export interface EntityKey {
  PK: string;
  SK: string;
}

export interface VersionedUpdateInput {
  tableName: string;
  key: EntityKey;
  tenantId: string;
  expectedVersion: number;
  /** Additional SET clauses beyond version/updatedAt, e.g. { status: "CANCELLED" }. */
  set: Record<string, unknown>;
  /** Attribute names to REMOVE atomically in the same conditional update - e.g. dropping
   * GSI6PK/GSI6SK when a reconciliation-candidate pointer (M3.5) stops applying. Gap noted
   * since M3 (occ.ts was SET-only, cancelled GSI3 pointers were left orphaned because
   * nothing actively queried them); M3.5 needs REMOVE for real because GSI6 pointers ARE
   * actively queried by reconciliation. */
  remove?: string[];
  now?: string;
}

export interface DynamoUpdateCommandInput {
  TableName: string;
  Key: EntityKey;
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

/**
 * Builds an UpdateItem input enforcing implementation-blueprint.md #5.2's exact
 * ConditionExpression: attribute_exists(PK) AND attribute_exists(SK) AND
 * #version = :expectedVersion AND #tenantId = :tenantId, and increments version atomically.
 */
export function buildVersionedUpdate(input: VersionedUpdateInput): DynamoUpdateCommandInput {
  const now = input.now ?? new Date().toISOString();

  const names: Record<string, string> = {
    "#version": "version",
    "#tenantId": "tenantId",
    "#updatedAt": "updatedAt",
  };
  const values: Record<string, unknown> = {
    ":expectedVersion": input.expectedVersion,
    ":tenantId": input.tenantId,
    ":one": 1,
    ":now": now,
  };

  const setClauses = ["#version = #version + :one", "#updatedAt = :now"];
  let i = 0;
  for (const [field, value] of Object.entries(input.set)) {
    const nameKey = `#set${i}`;
    const valueKey = `:set${i}`;
    names[nameKey] = field;
    values[valueKey] = value;
    setClauses.push(`${nameKey} = ${valueKey}`);
    i += 1;
  }

  const removeClauses: string[] = [];
  let j = 0;
  for (const field of input.remove ?? []) {
    const nameKey = `#rem${j}`;
    names[nameKey] = field;
    removeClauses.push(nameKey);
    j += 1;
  }

  const expression =
    removeClauses.length > 0
      ? `SET ${setClauses.join(", ")} REMOVE ${removeClauses.join(", ")}`
      : `SET ${setClauses.join(", ")}`;

  return {
    TableName: input.tableName,
    Key: input.key,
    UpdateExpression: expression,
    ConditionExpression:
      "attribute_exists(PK) AND attribute_exists(SK) AND #version = :expectedVersion AND #tenantId = :tenantId",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

export interface DynamoPutCommandInput {
  TableName: string;
  Item: Record<string, unknown>;
  ConditionExpression: string;
}

/**
 * Builds a PutItem input for first-time creation of a versioned entity, per
 * implementation-blueprint.md #5.2: ConditionExpression attribute_not_exists(PK) AND
 * attribute_not_exists(SK). Caller supplies `item` already containing PK/SK/tenantId/version=1.
 */
export function buildVersionedCreate(tableName: string, item: Record<string, unknown> & EntityKey): DynamoPutCommandInput {
  return {
    TableName: tableName,
    Item: item,
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
  };
}

/**
 * TransactWriteItems entry shapes - moved here from expiration/ports/expiration-store.ts
 * (2026-08-19, Engineering Maturity Review): that was the only place they were declared,
 * but reminder/ports/reminder-store.ts already re-exported them from there (a cross-module
 * ports->ports dependency), and expiration/domain/audit-event.ts imported them directly,
 * which is a domain->ports boundary violation dependency-cruiser catches but ESLint's
 * text-matching no-restricted-imports rule cannot (it only matches literal specifier
 * substrings, and this codebase's relative imports never contain "modules/"). Reuses the
 * inner Put/Update shapes already defined above instead of re-declaring them a third time.
 */
export interface TransactPutEntry {
  Put: DynamoPutCommandInput;
}

export interface TransactUpdateEntry {
  Update: DynamoUpdateCommandInput;
}

export type TransactWriteEntry = TransactPutEntry | TransactUpdateEntry;

/** Name of the AWS SDK error thrown when any entry in a TransactWriteItems call fails its
 * ConditionExpression - used by callers to distinguish OCC/idempotency conflicts from other
 * DynamoDB errors without importing the SDK type. */
export const TRANSACTION_CANCELED = "TransactionCanceledException";

export function isTransactionCanceled(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === TRANSACTION_CANCELED
  );
}

/** Name of the AWS SDK error thrown when a ConditionExpression fails - used by callers
 * to distinguish OCC conflicts from other DynamoDB errors without importing the SDK type. */
export const CONDITIONAL_CHECK_FAILED = "ConditionalCheckFailedException";

export function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === CONDITIONAL_CHECK_FAILED
  );
}
