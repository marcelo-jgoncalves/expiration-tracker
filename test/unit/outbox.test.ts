import { describe, expect, it } from "vitest";
import { appendToTransaction, buildOutboxRecord, nextAttemptDelayMs, outboxRecordCorrelationId, outboxShard } from "../../src/shared/outbox/outbox.js";
import type { DomainEvent } from "../../src/shared/contracts/events.js";

function sampleEvent(): DomainEvent {
  return {
    specVersion: "1.0",
    eventId: "evt_01",
    eventType: "expiration.item-due-date-changed.v1",
    source: "expiration-tracker.expiration",
    occurredAt: "2026-08-19T14:03:22.481Z",
    correlationId: "cor_01",
    tenantId: "t_01",
    actor: { type: "SYSTEM" },
    aggregate: { type: "ExpirationItem", id: "item_01", version: 8 },
    data: { itemId: "item_01", previousDueDate: null, newDueDate: "2026-09-01T00:00:00.000Z", itemVersion: 8 },
  };
}

describe("buildOutboxRecord", () => {
  it("matches the shape from implementation-blueprint.md #5.3, sub-sharded by eventId (2026-09-19 hot-partition fix)", () => {
    const record = buildOutboxRecord(sampleEvent());
    expect(record.PK).toBe("TENANT#t_01#OUTBOX#202608-7");
    expect(record.SK).toBe("EVENT#2026-08-19T14:03:22.481Z#evt_01");
    expect(record.status).toBe("PENDING");
    expect(record.GSI6PK).toBe("RECON#OUTBOX#PENDING");
    expect(record.publishAttempts).toBe(0);
  });

  it("copies event.correlationId explicitly (m5-observability-design.md #2) - never reads ambient context", () => {
    const record = buildOutboxRecord(sampleEvent());
    expect(record.correlationId).toBe("cor_01");
  });
});

describe("outboxShard", () => {
  // Catches: hardcoding the bucket instead of hashing eventId, or dropping the modulo (both
  // would make every eventId collapse onto the same bucket, defeating the whole fix).
  it("spreads different eventIds across more than one bucket in the same month", () => {
    const buckets = new Set(["evt_01", "evt_02", "evt_03", "evt_04", "evt_05"].map(id => outboxShard("2026-08-19T14:03:22.481Z", id)));
    expect(buckets.size).toBeGreaterThan(1);
  });

  // Catches: seeding the hash from `now`/Date.now() or anything non-deterministic - the whole
  // point is a stable point-read-able key (AWS's "calculated suffix" pattern), not a random one.
  it("is deterministic for the same (occurredAt, eventId) pair", () => {
    expect(outboxShard("2026-08-19T14:03:22.481Z", "evt_01")).toBe(outboxShard("2026-08-19T14:03:22.481Z", "evt_01"));
  });

  // Catches: dropping the month prefix entirely (would break the existing GSI6/relay assumption
  // that the shard still starts with the record's calendar month).
  it("keeps the month prefix ahead of the hash suffix", () => {
    expect(outboxShard("2026-08-19T14:03:22.481Z", "evt_01")).toMatch(/^202608-\d$/);
  });
});

describe("outboxRecordCorrelationId", () => {
  it("returns the record's correlationId when present", () => {
    const record = buildOutboxRecord(sampleEvent());
    expect(outboxRecordCorrelationId(record)).toBe("cor_01");
  });

  it("falls back to eventId for records persisted before M5 (no correlationId)", () => {
    const record = { ...buildOutboxRecord(sampleEvent()), correlationId: undefined };
    expect(outboxRecordCorrelationId(record)).toBe("evt_01");
  });
});

describe("appendToTransaction", () => {
  it("appends a conditional Put entry so the caller can commit it in the same TransactWriteItems as the aggregate write", () => {
    const tx: any[] = [{ Put: { TableName: "MainTable", Item: { PK: "x", SK: "y" }, ConditionExpression: "version=:v" } }];
    appendToTransaction(tx, "MainTable", sampleEvent());
    expect(tx).toHaveLength(2);
    expect(tx[1].Put.ConditionExpression).toBe("attribute_not_exists(PK) AND attribute_not_exists(SK)");
    expect(tx[1].Put.Item.eventType).toBe("expiration.item-due-date-changed.v1");
  });
});

describe("nextAttemptDelayMs", () => {
  it("grows exponentially and is capped", () => {
    expect(nextAttemptDelayMs(0)).toBe(1000);
    expect(nextAttemptDelayMs(1)).toBe(2000);
    expect(nextAttemptDelayMs(20)).toBe(5 * 60_000);
  });
});
