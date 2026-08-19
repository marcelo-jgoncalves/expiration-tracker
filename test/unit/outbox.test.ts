import { describe, expect, it } from "vitest";
import { appendToTransaction, buildOutboxRecord, nextAttemptDelayMs } from "../../src/shared/outbox/outbox.js";
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
  it("matches the shape from implementation-blueprint.md #5.3", () => {
    const record = buildOutboxRecord(sampleEvent());
    expect(record.PK).toBe("TENANT#t_01#OUTBOX#202608");
    expect(record.SK).toBe("EVENT#2026-08-19T14:03:22.481Z#evt_01");
    expect(record.status).toBe("PENDING");
    expect(record.GSI6PK).toBe("RECON#OUTBOX#PENDING");
    expect(record.publishAttempts).toBe(0);
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
