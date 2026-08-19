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

  return {
    TableName: input.tableName,
    Key: input.key,
    UpdateExpression: `SET ${setClauses.join(", ")}`,
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
