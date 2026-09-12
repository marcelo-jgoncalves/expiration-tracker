/**
 * P0.4 (ReminderPolicy 1:1 uniqueness fix - Claude<->Codex protocol APPROVED 9.2/10,
 * `docs/architecture/decisions-log.md` D-XXX) - Codex Round 4/5/6 explicitly required this
 * against REAL DynamoDB Local (not the in-memory fake): a fake "partial failure" doesn't
 * prove the real `TransactWriteItems` call is genuinely all-or-nothing. Camada 2 pattern,
 * same as `reminder-engine.dynamodb.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynamoDbLocal, TABLE_NAME } from "./setup.js";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { activePolicyPointerKey, policyKey, type PolicyRef, type ReminderPolicy } from "../../src/modules/reminder/domain/reminder-policy.js";
import { scanAll, decideGroup, buildRetireTransaction, run, type GroupDecision } from "../../scripts/migrate-reminder-policy-uniqueness.js";

describe("P0.4 ReminderPolicy uniqueness migration against REAL DynamoDB (Camada 2)", () => {
  let ctx: Awaited<ReturnType<typeof startDynamoDbLocal>>;

  beforeAll(async () => {
    ctx = await startDynamoDbLocal();
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  });

  const TENANT = "t1";
  const ITEM_ID = "item1";

  function makePolicy(policyId: string, updatedAt: string, overrides: Partial<ReminderPolicy> = {}): ReminderPolicy {
    return {
      ...policyKey(TENANT, policyId),
      entityType: "ReminderPolicy",
      policyId,
      tenantId: TENANT,
      scope: "ITEM",
      itemId: ITEM_ID,
      name: policyId,
      triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL"],
      enabled: true,
      version: 1,
      createdAt: updatedAt,
      updatedAt,
      ...overrides,
    };
  }

  async function put(item: object): Promise<void> {
    await ctx.client.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE_NAME, Item: item } }] }));
  }

  it("atomicity: a mid-transaction ConditionCheck failure (winner version stale) leaves NO loser tombstoned, NO outbox event, NO pointer written", async () => {
    const older = makePolicy("older-atomic", "2026-08-01T00:00:00.000Z");
    const newer = makePolicy("newer-atomic", "2026-08-02T00:00:00.000Z");
    await put(older);
    await put(newer);

    const decision = await decideGroup(ctx.client, TABLE_NAME, TENANT, ITEM_ID, [older, newer]);
    expect(decision.action).toBe("RETIRE");
    const retireDecision = decision as Extract<GroupDecision, { action: "RETIRE" }>;
    expect(retireDecision.winner.policyId).toBe("newer-atomic"); // most recently updated wins the desempate

    // Force the winner's fence to fail: build the transaction as if the winner were still
    // at version 1, but bump its real version first so the ConditionCheck loses.
    await ctx.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE_NAME,
              Key: policyKey(TENANT, "newer-atomic"),
              UpdateExpression: "SET #v = :v",
              ConditionExpression: "attribute_exists(PK)",
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: { ":v": 2 },
            },
          },
        ],
      }),
    );

    const entries = buildRetireTransaction(TABLE_NAME, retireDecision, "2026-08-03T00:00:00.000Z");
    await expect(ctx.client.send(new TransactWriteCommand({ TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] }))).rejects.toThrow();

    // Nothing else in the transaction may have committed - real proof, not a fake's approximation.
    const loserAfter = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: policyKey(TENANT, "older-atomic"), ConsistentRead: true }));
    expect((loserAfter.Item as ReminderPolicy | undefined)?.deletedAt).toBeUndefined();
    const pointerAfter = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: activePolicyPointerKey(TENANT, ITEM_ID), ConsistentRead: true }));
    expect(pointerAfter.Item).toBeUndefined();
  }, 30_000);

  it("success: 2 live duplicates, no pre-existing pointer - tombstones the loser (deletedAt+enabled:false+GSI8), fences+preserves the winner, creates the fixed pointer, emits one retirement event", async () => {
    const older = makePolicy("older-success", "2026-08-01T00:00:00.000Z");
    const newer = makePolicy("newer-success", "2026-08-02T00:00:00.000Z");
    const itemId = "item-success";
    await put({ ...older, itemId, PK: policyKey(TENANT, "older-success").PK });
    await put({ ...newer, itemId, PK: policyKey(TENANT, "newer-success").PK });

    const decision = await decideGroup(ctx.client, TABLE_NAME, TENANT, itemId, [
      { ...older, itemId },
      { ...newer, itemId },
    ]);
    expect(decision.action).toBe("RETIRE");
    const retireDecision = decision as Extract<GroupDecision, { action: "RETIRE" }>;
    expect(retireDecision.pointerAction).toBe("CREATE");

    const entries = buildRetireTransaction(TABLE_NAME, retireDecision, "2026-08-03T00:00:00.000Z");
    await ctx.client.send(new TransactWriteCommand({ TransactItems: entries as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"] }));

    const loserAfter = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: policyKey(TENANT, "older-success"), ConsistentRead: true }));
    const loser = loserAfter.Item as ReminderPolicy | undefined;
    expect(loser?.deletedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(loser?.enabled).toBe(false);
    expect(loser?.version).toBe(2);
    expect((loser as unknown as { GSI8PK?: string })?.GSI8PK).toBe("WORK#CORE_USER_DATA");

    const winnerAfter = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: policyKey(TENANT, "newer-success"), ConsistentRead: true }));
    expect((winnerAfter.Item as ReminderPolicy | undefined)?.version).toBe(1); // fenced, never mutated
    expect((winnerAfter.Item as ReminderPolicy | undefined)?.deletedAt).toBeUndefined();

    const pointerAfter = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: activePolicyPointerKey(TENANT, itemId), ConsistentRead: true }));
    expect((pointerAfter.Item as PolicyRef | undefined)?.policyId).toBe("newer-success");
  }, 30_000);

  it("full run(): scans, retires duplicates, cleans up legacy pointers, and a second run is a no-op (idempotent rerun)", async () => {
    const itemId = "item-full-run";
    const older = makePolicy("older-run", "2026-08-01T00:00:00.000Z", { itemId });
    const newer = makePolicy("newer-run", "2026-08-02T00:00:00.000Z", { itemId });
    await put({ ...older, PK: policyKey(TENANT, "older-run").PK });
    await put({ ...newer, PK: policyKey(TENANT, "newer-run").PK });
    // A legacy per-policy pointer for the loser (pre-P0.4 shape) - must be cleaned up.
    await put({ PK: `TENANT#${TENANT}#ITEM#${itemId}`, SK: "POLICYREF#older-run", entityType: "ReminderPolicyRef", policyId: "older-run", tenantId: TENANT });

    const firstSummary = await run(ctx.client, TABLE_NAME, false);
    expect(firstSummary.retired).toBeGreaterThanOrEqual(1);
    expect(firstSummary.legacyPointersDeleted).toBeGreaterThanOrEqual(1);

    const pointerAfterFirst = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: activePolicyPointerKey(TENANT, itemId), ConsistentRead: true }));
    expect((pointerAfterFirst.Item as PolicyRef | undefined)?.policyId).toBe("newer-run");
    const legacyAfterFirst = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${TENANT}#ITEM#${itemId}`, SK: "POLICYREF#older-run" }, ConsistentRead: true }));
    expect(legacyAfterFirst.Item).toBeUndefined();

    const secondSummary = await run(ctx.client, TABLE_NAME, false);
    // Second pass: the loser is now tombstoned (deletedAt set) so scanAll's Map A no longer
    // includes it - only the winner remains live, nothing left to retire for this item.
    const { liveByItemId } = await scanAll(ctx.client, TABLE_NAME);
    expect((liveByItemId.get(itemId) ?? []).map((p) => p.policyId)).toEqual(["newer-run"]);
    expect(secondSummary.legacyPointersDeleted).toBe(0);
  }, 30_000);

  it("0 live policies with an orphaned fixed pointer: the pointer is deleted, nothing else written", async () => {
    const itemId = "item-orphan";
    await put({ ...activePolicyPointerKey(TENANT, itemId), entityType: "ReminderPolicyRef", policyId: "ghost-policy", tenantId: TENANT });

    const decision = await decideGroup(ctx.client, TABLE_NAME, TENANT, itemId, []);
    expect(decision.action).toBe("DELETE_ORPHAN_FIXED_POINTER");

    await run(ctx.client, TABLE_NAME, false);

    const pointerAfter = await ctx.client.send(new GetCommand({ TableName: TABLE_NAME, Key: activePolicyPointerKey(TENANT, itemId), ConsistentRead: true }));
    expect(pointerAfter.Item).toBeUndefined();
  }, 30_000);
});
