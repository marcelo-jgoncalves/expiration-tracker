import { describe, expect, it } from "vitest";
import {
  buildVersionedCreate,
  buildVersionedUpdate,
  isConditionalCheckFailed,
} from "../../src/shared/dynamodb/occ.js";

describe("buildVersionedUpdate", () => {
  it("builds the exact ConditionExpression required by implementation-blueprint.md #5.2", () => {
    const cmd = buildVersionedUpdate({
      tableName: "MainTable",
      key: { PK: "TENANT#t_01#ITEM#item_01", SK: "META" },
      tenantId: "t_01",
      expectedVersion: 8,
      set: { status: "ACTIVE" },
    });
    expect(cmd.ConditionExpression).toBe(
      "attribute_exists(PK) AND attribute_exists(SK) AND #version = :expectedVersion AND #tenantId = :tenantId",
    );
    expect(cmd.ExpressionAttributeValues[":expectedVersion"]).toBe(8);
    expect(cmd.ExpressionAttributeValues[":tenantId"]).toBe("t_01");
  });

  it("increments version and sets updatedAt in the UpdateExpression", () => {
    const cmd = buildVersionedUpdate({
      tableName: "MainTable",
      key: { PK: "PK1", SK: "SK1" },
      tenantId: "t_01",
      expectedVersion: 1,
      set: {},
      now: "2026-08-19T00:00:00.000Z",
    });
    expect(cmd.UpdateExpression).toContain("#version = #version + :one");
    expect(cmd.UpdateExpression).toContain("#updatedAt = :now");
    expect(cmd.ExpressionAttributeValues[":now"]).toBe("2026-08-19T00:00:00.000Z");
  });

  it("maps arbitrary `set` fields to distinct expression attribute placeholders", () => {
    const cmd = buildVersionedUpdate({
      tableName: "MainTable",
      key: { PK: "PK1", SK: "SK1" },
      tenantId: "t_01",
      expectedVersion: 1,
      set: { status: "CANCELLED", note: "x" },
    });
    expect(cmd.ExpressionAttributeNames["#set0"]).toBe("status");
    expect(cmd.ExpressionAttributeValues[":set0"]).toBe("CANCELLED");
    expect(cmd.ExpressionAttributeNames["#set1"]).toBe("note");
  });
});

describe("buildVersionedCreate", () => {
  it("builds the attribute_not_exists ConditionExpression for first creation", () => {
    const cmd = buildVersionedCreate("MainTable", {
      PK: "TENANT#t_01#ITEM#item_01",
      SK: "META",
      version: 1,
    });
    expect(cmd.ConditionExpression).toBe("attribute_not_exists(PK) AND attribute_not_exists(SK)");
    expect(cmd.Item.version).toBe(1);
  });
});

describe("isConditionalCheckFailed", () => {
  it("recognizes AWS SDK ConditionalCheckFailedException-shaped errors", () => {
    const err = { name: "ConditionalCheckFailedException", message: "boom" };
    expect(isConditionalCheckFailed(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isConditionalCheckFailed(new Error("other"))).toBe(false);
    expect(isConditionalCheckFailed(null)).toBe(false);
  });
});
