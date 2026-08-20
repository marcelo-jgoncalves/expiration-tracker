import { describe, expect, it } from "vitest";
import { publishOne, sweepPendingDispatch, type RelayDeps } from "../../../src/workers/dispatch-outbox-relay/relay.js";
import type { OutboxRecord } from "../../../src/shared/outbox/outbox.js";
import type { OutboxRelayStore } from "../../../src/shared/outbox/relay-store.js";

function makeRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    PK: "TENANT#t1#OUTBOX#202608",
    SK: "EVENT#2026-08-19T10:00:00.000Z#evt-1",
    entityType: "OutboxEvent",
    eventId: "evt-1",
    eventType: "ReminderDispatchRequested",
    aggregateType: "ReminderOccurrence",
    aggregateId: "occ-1",
    aggregateVersion: 1,
    status: "PENDING",
    occurredAt: "2026-08-19T10:00:00.000Z",
    payload: { commandType: "reminder.dispatch.v1" },
    publishAttempts: 0,
    nextAttemptAt: "2026-08-19T10:00:00.000Z",
    createdAt: "2026-08-19T10:00:00.000Z",
    GSI6PK: "RECON#OUTBOX#PENDING",
    GSI6SK: "2026-08-19T10:00:00.000Z#evt-1",
    destination: "SQS_REMINDER_DISPATCH_V1",
    ...overrides,
  };
}

class FakeRelayStore implements OutboxRelayStore {
  leases = new Map<string, { owner: string; expiresAt: string }>();
  published = new Set<string>();
  pending: OutboxRecord[] = [];

  private keyOf(key: { PK: string; SK: string }) {
    return `${key.PK}#${key.SK}`;
  }

  async tryAcquireLease(key: { PK: string; SK: string }, owner: string, expiresAt: string, now: string): Promise<boolean> {
    const k = this.keyOf(key);
    const existing = this.leases.get(k);
    if (existing && existing.expiresAt >= now) return false;
    this.leases.set(k, { owner, expiresAt });
    return true;
  }

  async markPublished(key: { PK: string; SK: string }): Promise<void> {
    this.published.add(this.keyOf(key));
    this.leases.delete(this.keyOf(key));
  }

  async listPendingReminderDispatch(input: { destination: string }): Promise<OutboxRecord[]> {
    return this.pending.filter((r) => r.destination === input.destination);
  }
}

describe("DispatchOutboxRelay / OutboxSweeperReminderDispatch core logic (M3.5)", () => {
  it("publishes a pending record with the right destination", async () => {
    const store = new FakeRelayStore();
    const sent: unknown[] = [];
    const deps: RelayDeps = {
      store,
      senders: {
        SQS_REMINDER_DISPATCH_V1: async (payload) => {
          sent.push(payload);
        },
      },
      now: () => "2026-08-19T10:00:05.000Z",
      leaseOwner: "relay-1",
    };
    const outcome = await publishOne(deps, makeRecord());
    expect(outcome.kind).toBe("PUBLISHED");
    expect(sent).toHaveLength(1);
    expect(store.published.has("TENANT#t1#OUTBOX#202608#EVENT#2026-08-19T10:00:00.000Z#evt-1")).toBe(true);
  });

  it("routing exclusivity: never touches a record without a recognized destination", async () => {
    const store = new FakeRelayStore();
    const sent: unknown[] = [];
    const deps: RelayDeps = {
      store,
      senders: {
        SQS_REMINDER_DISPATCH_V1: async (payload) => {
          sent.push(payload);
        },
      },
      now: () => "2026-08-19T10:00:05.000Z",
      leaseOwner: "relay-1",
    };
    const outcome = await publishOne(deps, makeRecord({ destination: undefined, eventType: "ItemDueDateChanged" }));
    expect(outcome.kind).toBe("SKIPPED_WRONG_DESTINATION");
    expect(sent).toHaveLength(0);
    expect(store.published.size).toBe(0);
  });

  it("skips an already-PUBLISHED record", async () => {
    const store = new FakeRelayStore();
    const deps: RelayDeps = {
      store,
      senders: { SQS_REMINDER_DISPATCH_V1: async () => {} },
      now: () => "2026-08-19T10:00:05.000Z",
      leaseOwner: "relay-1",
    };
    const outcome = await publishOne(deps, makeRecord({ status: "PUBLISHED" }));
    expect(outcome.kind).toBe("SKIPPED_ALREADY_PUBLISHED");
  });

  it("two concurrent relays racing the same record: only one publishes (lease contention)", async () => {
    const store = new FakeRelayStore();
    const sent: unknown[] = [];
    const record = makeRecord();
    const senders = { SQS_REMINDER_DISPATCH_V1: async (p: Record<string, unknown>) => void sent.push(p) };
    const depsA: RelayDeps = { store, senders, now: () => "2026-08-19T10:00:05.000Z", leaseOwner: "relay-A" };
    const depsB: RelayDeps = { store, senders, now: () => "2026-08-19T10:00:05.000Z", leaseOwner: "relay-B" };

    const [a, b] = await Promise.all([publishOne(depsA, record), publishOne(depsB, record)]);
    const outcomes = [a.kind, b.kind].sort();
    expect(outcomes).toEqual(["PUBLISHED", "SKIPPED_LEASE_HELD"]);
    expect(sent).toHaveLength(1);
  });

  it("SendMessage failure leaves the record recoverable (not marked published, lease will expire)", async () => {
    const store = new FakeRelayStore();
    const deps: RelayDeps = {
      store,
      senders: {
        SQS_REMINDER_DISPATCH_V1: async () => {
          throw new Error("SQS unavailable");
        },
      },
      now: () => "2026-08-19T10:00:05.000Z",
      leaseOwner: "relay-1",
    };
    const outcome = await publishOne(deps, makeRecord());
    expect(outcome.kind).toBe("FAILED");
    expect(store.published.size).toBe(0);
  });

  it("sweeper: publishes every pending SQS_REMINDER_DISPATCH_V1 candidate returned by the store", async () => {
    const store = new FakeRelayStore();
    store.pending = [makeRecord({ SK: "EVENT#...#evt-1", eventId: "evt-1" }), makeRecord({ SK: "EVENT#...#evt-2", eventId: "evt-2", GSI6SK: "x2" })];
    const sent: unknown[] = [];
    const result = await sweepPendingDispatch({
      store,
      senders: { SQS_REMINDER_DISPATCH_V1: async (p) => void sent.push(p) },
      now: () => "2026-08-19T10:05:00.000Z",
      leaseOwner: "sweeper-1",
    });
    expect(result).toEqual({ attempted: 2, published: 2, failed: 0, stillPending: 0 });
    expect(sent).toHaveLength(2);
  });

  it("sweeper (M4): routes each destination to its own sender in a single run, without a second GSI query mechanism", async () => {
    const store = new FakeRelayStore();
    store.pending = [
      makeRecord({ SK: "EVENT#...#evt-1", eventId: "evt-1", destination: "SQS_REMINDER_DISPATCH_V1" }),
      makeRecord({ SK: "EVENT#...#evt-2", eventId: "evt-2", GSI6SK: "x2", destination: "SQS_NOTIFICATION_EMAIL_V1" }),
    ];
    const reminderSent: unknown[] = [];
    const emailSent: unknown[] = [];
    const result = await sweepPendingDispatch({
      store,
      senders: {
        SQS_REMINDER_DISPATCH_V1: async (p) => void reminderSent.push(p),
        SQS_NOTIFICATION_EMAIL_V1: async (p) => void emailSent.push(p),
      },
      now: () => "2026-08-19T10:05:00.000Z",
      leaseOwner: "sweeper-1",
    });
    expect(result).toEqual({ attempted: 2, published: 2, failed: 0, stillPending: 0 });
    expect(reminderSent).toHaveLength(1);
    expect(emailSent).toHaveLength(1);
  });
});
