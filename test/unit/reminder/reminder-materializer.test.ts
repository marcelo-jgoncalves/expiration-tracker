import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReminderStore } from "./in-memory-store.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import type { ReminderPolicy } from "../../../src/modules/reminder/domain/reminder-policy.js";
import type { ReminderOccurrence } from "../../../src/modules/reminder/domain/reminder-occurrence.js";

function policy(overrides: Partial<ReminderPolicy> = {}): ReminderPolicy {
  return {
    PK: "TENANT#t1#POLICY#p1",
    SK: "META",
    entityType: "ReminderPolicy",
    policyId: "p1",
    tenantId: "t1",
    scope: "ITEM",
    itemId: "item1",
    name: "7 days before",
    triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }],
    timeZone: "America/Sao_Paulo",
    channels: ["EMAIL"],
    enabled: true,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ReminderMaterializer (implementation-blueprint.md §9.2)", () => {
  let store: InMemoryReminderStore;
  let materializer: ReminderMaterializer;

  beforeEach(() => {
    store = new InMemoryReminderStore();
    materializer = new ReminderMaterializer(store, "MainTable", () => "2026-08-01T00:00:00.000Z");
  });

  it("materializes one occurrence per trigger with correct GSI3 keys", async () => {
    const result = await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    });

    expect(result.created).toHaveLength(1);
    const occ = result.created[0]!;
    expect(occ.status).toBe("SCHEDULED");
    expect(occ.scheduledAt).toBe("2026-09-03T12:00:00.000Z"); // 7 days before 09-10, 09:00 -03:00
    expect(occ.GSI3PK).toBe("DUE#202609031200#" + occ.shard);
    expect(occ.GSI3SK).toBe("TENANT#t1#OCCURRENCE#" + occ.occurrenceId);
  });

  it("is idempotent: calling materialize twice for the same (itemVersion, policyVersion) creates nothing new", async () => {
    const input = {
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    };
    const first = await materializer.materialize(input);
    const second = await materializer.materialize(input);
    expect(first.created).toHaveLength(1);
    expect(second.created).toHaveLength(0);
    expect(second.skippedExisting).toBe(1);
  });

  it("does not materialize anything for a disabled policy", async () => {
    const result = await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy({ enabled: false }),
      shardConfig: defaultShardConfig(),
    });
    expect(result.created).toHaveLength(0);
  });

  it("cancelStaleOccurrences cancels only SCHEDULED/CLAIMED occurrences from an older itemVersion, leaving current-version ones untouched", async () => {
    await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 1,
      itemDueDate: "2026-09-10",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    });
    await materializer.materialize({
      tenantId: "t1",
      itemId: "item1",
      itemVersion: 2,
      itemDueDate: "2026-10-01",
      policy: policy(),
      shardConfig: defaultShardConfig(),
    });

    const cancelled = await materializer.cancelStaleOccurrences({ tenantId: "t1", itemId: "item1", currentItemVersion: 2 });
    expect(cancelled).toBe(1);

    const all = (await store.queryByItem<ReminderOccurrence>("t1", "item1")) as ReminderOccurrence[];
    const v1 = all.find((o) => o.itemVersion === 1)!;
    const v2 = all.find((o) => o.itemVersion === 2)!;
    expect(v1.status).toBe("CANCELLED");
    expect(v2.status).toBe("SCHEDULED");
  });
});
