import { describe, expect, it } from "vitest";
import { purgeTenantDynamoItems, type TenantPurgeCandidateSource, type TenantScanItem } from "../../../../src/workers/tenant-purge/dynamo-tenant-purge.js";
import { InMemoryIdentityStore } from "../../identity/in-memory-store.js";

/** Fake candidate source: a flat in-memory list of tenant items, paginated by a fixed page size,
 * mirroring a real Scan's ExclusiveStartKey/LastEvaluatedKey contract. */
class FakeTenantScanSource implements TenantPurgeCandidateSource {
  constructor(
    private readonly itemsByTenant: Map<string, TenantScanItem[]>,
    private readonly pageSize = 2,
  ) {}

  async scanTenantItems(tenantId: string, exclusiveStartKey?: Record<string, unknown>) {
    const all = (this.itemsByTenant.get(tenantId) ?? []).filter((item) => item.PK.startsWith(`TENANT#${tenantId}#`));
    const startIndex = exclusiveStartKey ? (exclusiveStartKey["offset"] as number) : 0;
    const page = all.slice(startIndex, startIndex + this.pageSize);
    const nextOffset = startIndex + this.pageSize;
    return {
      items: page,
      lastEvaluatedKey: nextOffset < all.length ? { offset: nextOffset } : undefined,
    };
  }
}

function item(tenantId: string, id: string, entityType: string): TenantScanItem {
  return { PK: `TENANT#${tenantId}#ITEM#${id}`, SK: "ITEM", entityType, tenantId, version: 1 };
}

describe("purgeTenantDynamoItems", () => {
  it("enumerates and deletes every tenant-owned item across multiple pages", async () => {
    const store = new InMemoryIdentityStore();
    const items = [item("t1", "a", "ExpirationItem"), item("t1", "b", "Document"), item("t1", "c", "ImportJob"), item("t1", "d", "UploadSlot"), item("t1", "e", "OutboxEvent")];
    for (const i of items) store.seedRaw(i);

    const source = new FakeTenantScanSource(new Map([["t1", items]]), 2);
    const result = await purgeTenantDynamoItems({ store, candidates: source, tableName: "MainTable" }, { tenantId: "t1" });

    expect(result.itemsPurged).toBe(5);
    expect(result.itemsExcluded).toBe(0);
    expect(result.itemsRejectedBySafetyCondition).toBe(0);
    for (const i of items) expect(store.hasRaw({ PK: i.PK, SK: i.SK })).toBe(false);
  });

  it("explicitly leaves TenantLifecycleRecord and IdentityMapping untouched, even if a scan somehow returns them", async () => {
    const store = new InMemoryIdentityStore();
    const lifecycle: TenantScanItem = { PK: "TENANT#t1#LIFECYCLE", SK: "LIFECYCLE", entityType: "TenantLifecycleRecord", tenantId: "t1", status: "PURGING", version: 3 };
    const mapping: TenantScanItem = { PK: "TENANT#t1#IDENTITYMAP", SK: "IDENTITYMAP", entityType: "IdentityMapping", tenantId: "t1", version: 1 };
    const survivor = item("t1", "survivor", "ExpirationItem");
    store.seedRaw(lifecycle);
    store.seedRaw(mapping);
    store.seedRaw(survivor);

    const source = new FakeTenantScanSource(new Map([["t1", [lifecycle, mapping, survivor]]]), 10);
    const result = await purgeTenantDynamoItems({ store, candidates: source, tableName: "MainTable" }, { tenantId: "t1" });

    expect(result.itemsPurged).toBe(1);
    expect(result.itemsExcluded).toBe(2);
    expect(store.hasRaw({ PK: lifecycle.PK, SK: lifecycle.SK })).toBe(true);
    expect(store.hasRaw({ PK: mapping.PK, SK: mapping.SK })).toBe(true);
    expect(store.hasRaw({ PK: survivor.PK, SK: survivor.SK })).toBe(false);
  });

  it("tenant isolation: purging tenant A never touches tenant B's items, even from the same underlying store", async () => {
    const store = new InMemoryIdentityStore();
    const tenantAItems = [item("tenant-a", "1", "ExpirationItem")];
    const tenantBItems = [item("tenant-b", "1", "ExpirationItem")];
    for (const i of [...tenantAItems, ...tenantBItems]) store.seedRaw(i);

    const source = new FakeTenantScanSource(
      new Map([
        ["tenant-a", tenantAItems],
        ["tenant-b", tenantBItems],
      ]),
      10,
    );
    await purgeTenantDynamoItems({ store, candidates: source, tableName: "MainTable" }, { tenantId: "tenant-a" });

    expect(store.hasRaw({ PK: tenantAItems[0]!.PK, SK: tenantAItems[0]!.SK })).toBe(false);
    expect(store.hasRaw({ PK: tenantBItems[0]!.PK, SK: tenantBItems[0]!.SK })).toBe(true);
  });

  it("idempotent: re-running against an already-purged tenant is a clean no-op, never an error", async () => {
    const store = new InMemoryIdentityStore();
    const items = [item("t1", "a", "ExpirationItem"), item("t1", "b", "Document")];
    for (const i of items) store.seedRaw(i);
    // The scan source is intentionally NOT re-queried against the store's live state (mirrors a
    // real Scan re-run, which would return zero items once everything is actually deleted) - use
    // a source that reflects the store's current membership.
    const source: TenantPurgeCandidateSource = {
      async scanTenantItems(tenantId: string) {
        return { items: items.filter((i) => store.hasRaw({ PK: i.PK, SK: i.SK })).filter((i) => i.tenantId === tenantId) };
      },
    };

    const first = await purgeTenantDynamoItems({ store, candidates: source, tableName: "MainTable" }, { tenantId: "t1" });
    expect(first.itemsPurged).toBe(2);

    const second = await purgeTenantDynamoItems({ store, candidates: source, tableName: "MainTable" }, { tenantId: "t1" });
    expect(second.itemsPurged).toBe(0);
    expect(second.itemsExcluded).toBe(0);
    expect(second.itemsRejectedBySafetyCondition).toBe(0);
  });

  it("reports checkpoint progress via onCheckpoint after every page, ending with undefined once fully done", async () => {
    const store = new InMemoryIdentityStore();
    const items = [item("t1", "a", "ExpirationItem"), item("t1", "b", "Document"), item("t1", "c", "ImportJob")];
    for (const i of items) store.seedRaw(i);
    const source = new FakeTenantScanSource(new Map([["t1", items]]), 2);

    const checkpoints: Array<Record<string, unknown> | undefined> = [];
    await purgeTenantDynamoItems({ store, candidates: source, tableName: "MainTable", onCheckpoint: async (cp) => void checkpoints.push(cp) }, { tenantId: "t1" });

    expect(checkpoints.length).toBe(2); // page 1 (2 items), page 2 (1 item)
    expect(checkpoints[0]).toEqual({ offset: 2 });
    expect(checkpoints[1]).toBeUndefined();
  });
});
