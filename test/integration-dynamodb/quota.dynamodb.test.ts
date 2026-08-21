/**
 * Camada 2 (docs/architecture/m3.5-runtime-design.md) - real regression test for a
 * production bug found via a live `aws lambda invoke` smoke test against
 * exptrk-dev-notifications-handler (2026-08-21): `DynamoDbIdentityStore.updateConditional`
 * used the bare attribute name `count` in its `ConditionExpression` - `count` is a DynamoDB
 * reserved word, so every real call failed with `ValidationException`. This was invisible to
 * every existing unit test because `InMemoryIdentityStore` (test/unit/identity/in-memory-store.ts)
 * doesn't parse condition expressions the way real DynamoDB does - it can't catch a reserved-
 * word bug by construction. Only a real DynamoDB wire-protocol test (this file) can.
 *
 * Reproduction: `TenantQuotaService.consume()`'s FIRST call for a given bucket uses
 * `putIfAbsent` (no ConditionExpression referencing `count`), so it always succeeded even
 * with the bug - only the SECOND call within the same window hits `updateConditional` and
 * would have failed for real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDynamoDbLocal, TABLE_NAME } from "./setup.js";
import { DynamoDbIdentityStore } from "../../src/modules/identity/persistence/dynamodb-identity-store.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { QuotaExceededError } from "../../src/shared/errors/app-error.js";

describe("TenantQuotaService against REAL DynamoDB (Camada 2)", () => {
  let ctx: Awaited<ReturnType<typeof startDynamoDbLocal>>;
  let store: DynamoDbIdentityStore;

  beforeAll(async () => {
    ctx = await startDynamoDbLocal();
    store = new DynamoDbIdentityStore(ctx.client, TABLE_NAME);
  }, 60_000);

  afterAll(async () => {
    await ctx.stop();
  });

  it("a second consume() call within the same window hits updateConditional against real DynamoDB without a reserved-word ValidationException", async () => {
    const quota = new TenantQuotaService(store);
    const input = { tenantId: "t-dynamo-quota", quotaType: "API_REQUEST" as const, window: "w1", limit: 5, windowSeconds: 60 };

    // First call: putIfAbsent path (never exercised the bug).
    await quota.consume(input);
    // Second call: updateConditional path - this is exactly what failed in production.
    await quota.consume(input);
    await quota.consume(input);

    const record = await store.get<{ PK: string; SK: string; count: number }>({
      PK: `TENANT#${input.tenantId}#QUOTA`,
      SK: `TYPE#${input.quotaType}#${input.window}`,
    });
    expect(record?.count).toBe(3);
  });

  it("still enforces the limit correctly once exhausted (proves updateConditional's real writes actually land)", async () => {
    const quota = new TenantQuotaService(store);
    const input = { tenantId: "t-dynamo-quota-2", quotaType: "API_REQUEST" as const, window: "w1", limit: 2, windowSeconds: 60 };

    await quota.consume(input);
    await quota.consume(input);
    await expect(quota.consume(input)).rejects.toBeInstanceOf(QuotaExceededError);
  });
});
