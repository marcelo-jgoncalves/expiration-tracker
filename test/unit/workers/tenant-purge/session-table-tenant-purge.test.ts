import { describe, expect, it } from "vitest";
import { purgeTenantSessions, type SessionTablePurgeSource, type SessionTableScanItem } from "../../../../src/workers/tenant-purge/session-table-tenant-purge.js";

class FakeSessionTable implements SessionTablePurgeSource {
  private readonly items = new Map<string, SessionTableScanItem>();

  constructor(seed: SessionTableScanItem[]) {
    for (const item of seed) this.items.set(item.PK, item);
  }

  async scanTenantSessions(tenantId: string, exclusiveStartKey?: Record<string, unknown>) {
    // Real DynamoDB/S3 pagination markers denote a KEY to resume after, not a numeric index -
    // resuming correctly even as earlier pages' items are deleted between calls (deletion never
    // affects the relative order of keys that come after the marker). Index-based paging over a
    // shrinking live map would incorrectly skip items once earlier pages are deleted.
    const marker = exclusiveStartKey ? (exclusiveStartKey["afterPk"] as string) : undefined;
    const all = [...this.items.values()]
      .filter((i) => i.tenantId === tenantId)
      .sort((a, b) => a.PK.localeCompare(b.PK));
    const startIndex = marker ? all.findIndex((i) => i.PK > marker) : 0;
    const effectiveStart = startIndex === -1 ? all.length : startIndex;
    const pageSize = 2;
    const page = all.slice(effectiveStart, effectiveStart + pageSize);
    const hasMore = effectiveStart + pageSize < all.length;
    return { items: page, lastEvaluatedKey: hasMore ? { afterPk: page.at(-1)?.PK } : undefined };
  }

  async deleteSession(key: { PK: string; SK: string }): Promise<void> {
    this.items.delete(key.PK);
  }

  has(pk: string): boolean {
    return this.items.has(pk);
  }
}

function session(tenantId: string, selector: string): SessionTableScanItem {
  return { PK: `SESSION#${selector}`, SK: "POINTER", tenantId };
}

describe("purgeTenantSessions", () => {
  it("enumerates and deletes every Session row for a tenant across multiple pages", async () => {
    const table = new FakeSessionTable([session("t1", "a"), session("t1", "b"), session("t1", "c")]);
    const result = await purgeTenantSessions({ source: table }, { tenantId: "t1" });

    expect(result.sessionsPurged).toBe(3);
    expect(table.has("SESSION#a")).toBe(false);
    expect(table.has("SESSION#b")).toBe(false);
    expect(table.has("SESSION#c")).toBe(false);
  });

  it("tenant isolation: purging tenant A never deletes tenant B's sessions", async () => {
    const table = new FakeSessionTable([session("tenant-a", "1"), session("tenant-b", "2")]);
    await purgeTenantSessions({ source: table }, { tenantId: "tenant-a" });

    expect(table.has("SESSION#1")).toBe(false);
    expect(table.has("SESSION#2")).toBe(true);
  });

  it("idempotent: re-running after everything is already purged is a clean no-op", async () => {
    const table = new FakeSessionTable([session("t1", "a")]);
    const first = await purgeTenantSessions({ source: table }, { tenantId: "t1" });
    expect(first.sessionsPurged).toBe(1);

    const second = await purgeTenantSessions({ source: table }, { tenantId: "t1" });
    expect(second.sessionsPurged).toBe(0);
  });

  it("defense-in-depth: skips an item whose tenantId does not match even if a scan/filter bug returned it", async () => {
    const table = new FakeSessionTable([session("t1", "a")]);
    // Simulate a broken scan that returns a foreign-tenant row despite being asked for t1.
    const brokenSource: SessionTablePurgeSource = {
      async scanTenantSessions() {
        return { items: [session("tenant-other", "z")] };
      },
      deleteSession: table.deleteSession.bind(table),
    };
    const result = await purgeTenantSessions({ source: brokenSource }, { tenantId: "t1" });
    expect(result.sessionsPurged).toBe(0);
  });

  it("reports checkpoint progress via onCheckpoint", async () => {
    const table = new FakeSessionTable([session("t1", "a"), session("t1", "b"), session("t1", "c")]);
    const checkpoints: Array<Record<string, unknown> | undefined> = [];
    await purgeTenantSessions({ source: table, onCheckpoint: async (cp) => void checkpoints.push(cp) }, { tenantId: "t1" });
    expect(checkpoints.length).toBe(2);
    expect(checkpoints[1]).toBeUndefined();
  });
});
