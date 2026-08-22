import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore } from "./in-memory-store.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { QuotaExceededError } from "../../../src/shared/errors/app-error.js";

describe("TenantQuotaService", () => {
  it("allows requests under the limit and denies once exhausted", async () => {
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store);
    const input = { tenantId: "tenant-a", quotaType: "API_REQUEST" as const, window: "w1", limit: 3, windowSeconds: 60 };

    await quota.consume(input);
    await quota.consume(input);
    await quota.consume(input);
    await expect(quota.consume(input)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("does not let a different tenant share another tenant's bucket", async () => {
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store);
    const a = { tenantId: "tenant-a", quotaType: "API_REQUEST" as const, window: "w1", limit: 1, windowSeconds: 60 };
    const b = { tenantId: "tenant-b", quotaType: "API_REQUEST" as const, window: "w1", limit: 1, windowSeconds: 60 };

    await quota.consume(a);
    await expect(quota.consume(a)).rejects.toBeInstanceOf(QuotaExceededError);
    // tenant-b's own bucket is untouched by tenant-a exhausting theirs.
    await expect(quota.consume(b)).resolves.toBeUndefined();
  });

  it("resets the window after resetAt elapses", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store, () => new Date(now).toISOString());
    const input = { tenantId: "tenant-a", quotaType: "API_REQUEST" as const, window: "w1", limit: 1, windowSeconds: 60 };

    await quota.consume(input);
    await expect(quota.consume(input)).rejects.toBeInstanceOf(QuotaExceededError);

    now += 61_000;
    await expect(quota.consume(input)).resolves.toBeUndefined();
  });

  it("kill switch override denies regardless of remaining count", async () => {
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store);
    const key = { PK: "TENANT#tenant-a#QUOTA", SK: "TYPE#AI_CALL#w1" };
    await store.putIfAbsent({
      ...key,
      entityType: "TenantQuota",
      tenantId: "tenant-a",
      quotaType: "AI_CALL",
      limit: 100,
      windowSeconds: 60,
      count: 0,
      resetAt: new Date(Date.now() + 60_000).toISOString(),
      killSwitchOverride: true,
    });

    await expect(
      quota.consume({ tenantId: "tenant-a", quotaType: "AI_CALL", window: "w1", limit: 100, windowSeconds: 60 }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("does not lose updates under concurrent consume() for the same tenant/quotaType (full-audit round1, eixo Produto, critério 3)", async () => {
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store);
    const input = { tenantId: "tenant-a", quotaType: "API_REQUEST" as const, window: "w1", limit: 10, windowSeconds: 60 };

    const results = await Promise.allSettled(Array.from({ length: 25 }, () => quota.consume(input)));
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    // The unconditional store.update() this replaced allowed concurrent readers to overwrite
    // each other's increment, so more than `limit` requests could succeed (lost updates) - the
    // fixed conditional write must let exactly `limit` through, never more.
    expect(fulfilled).toBe(input.limit);
    expect(rejected).toBe(25 - input.limit);
  });

  it("release() decrements a previously-consumed unit, freeing capacity for a new consume() in the same window (M6 UploadSlotReconciliationWorker)", async () => {
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store);
    const input = { tenantId: "tenant-a", quotaType: "UPLOAD_COUNT" as const, window: "w1", limit: 1, windowSeconds: 60 };

    await quota.consume(input);
    await expect(quota.consume(input)).rejects.toBeInstanceOf(QuotaExceededError);

    await quota.release(input);
    await expect(quota.consume(input)).resolves.toBeUndefined();
  });

  it("release() is idempotent and never decrements below 0", async () => {
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store);
    const input = { tenantId: "tenant-a", quotaType: "UPLOAD_COUNT" as const, window: "w1", limit: 5, windowSeconds: 60 };

    await quota.consume(input);
    await quota.release(input);
    await expect(quota.release(input)).resolves.toBeUndefined(); // second release: no-op, not an error.
  });

  it("release() is a no-op when nothing has been consumed for that window yet", async () => {
    const store = new InMemoryIdentityStore();
    const quota = new TenantQuotaService(store);
    await expect(quota.release({ tenantId: "tenant-a", quotaType: "UPLOAD_COUNT", window: "w1", windowSeconds: 60 })).resolves.toBeUndefined();
  });
});
