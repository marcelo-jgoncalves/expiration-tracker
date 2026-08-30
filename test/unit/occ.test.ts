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
    // buildVersionedUpdate() always populates ExpressionAttributeNames (at minimum
    // #version/#tenantId/#updatedAt) - never the empty-object case update-organization-settings.ts
    // hit for real (D-119) - safe to assert non-null here.
    expect(cmd.ExpressionAttributeNames!["#set0"]).toBe("status");
    expect(cmd.ExpressionAttributeValues[":set0"]).toBe("CANCELLED");
    expect(cmd.ExpressionAttributeNames!["#set1"]).toBe("note");
  });

  it("ANDs extraConditions into the ConditionExpression, each wrapped in its own parens", () => {
    const cmd = buildVersionedUpdate({
      tableName: "MainTable",
      key: { PK: "PK1", SK: "SK1" },
      tenantId: "t_01",
      expectedVersion: 1,
      set: { status: "CLAIMED" },
      extraConditions: [
        { expression: "attribute_not_exists(#legalHold) OR #legalHold = :false", names: { "#legalHold": "legalHold" }, values: { ":false": false } },
        { expression: "purgeAfter <= :purgeCutoff", values: { ":purgeCutoff": "2026-08-28T00:00:00.000Z" } },
      ],
    });
    expect(cmd.ConditionExpression).toBe(
      "attribute_exists(PK) AND attribute_exists(SK) AND #version = :expectedVersion AND #tenantId = :tenantId" +
        " AND (attribute_not_exists(#legalHold) OR #legalHold = :false) AND (purgeAfter <= :purgeCutoff)",
    );
    expect(cmd.ExpressionAttributeNames!["#legalHold"]).toBe("legalHold");
    expect(cmd.ExpressionAttributeValues[":false"]).toBe(false);
    expect(cmd.ExpressionAttributeValues[":purgeCutoff"]).toBe("2026-08-28T00:00:00.000Z");
  });

  it("throws if an extraConditions placeholder collides with a reserved or generated key", () => {
    expect(() =>
      buildVersionedUpdate({
        tableName: "MainTable",
        key: { PK: "PK1", SK: "SK1" },
        tenantId: "t_01",
        expectedVersion: 1,
        set: {},
        extraConditions: [{ expression: "purgeAfter <= :now", values: { ":now": "2026-08-28T00:00:00.000Z" } }],
      }),
    ).toThrow(/collides/);

    expect(() =>
      buildVersionedUpdate({
        tableName: "MainTable",
        key: { PK: "PK1", SK: "SK1" },
        tenantId: "t_01",
        expectedVersion: 1,
        set: { status: "X" },
        extraConditions: [{ expression: "#set0 = :other", names: { "#set0": "status" }, values: { ":other": "Y" } }],
      }),
    ).toThrow(/collides/);
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
