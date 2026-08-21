import { marshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBRecord } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { processStreamRecords } from "../../src/runtime/aws/handlers/dispatch-outbox-relay-processor.js";
import { getContext } from "../../src/shared/observability/context.js";
import { SecureLogger } from "../../src/shared/observability/logger.js";
import type { OutboxRecord } from "../../src/shared/outbox/outbox.js";
import type { OutboxRelayStore } from "../../src/shared/outbox/relay-store.js";

function outboxRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
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

function streamRecord(eventID: string, record: OutboxRecord): DynamoDBRecord {
  return {
    eventID,
    eventName: "INSERT",
    dynamodb: {
      SequenceNumber: `seq-${eventID}`,
      NewImage: marshall(record) as never,
    },
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

describe("dispatch-outbox-relay-handler processStreamRecords - partial batch failure (m5-observability-design.md §5)", () => {
  it("3 records, the 2nd send fails: batchItemFailures reports only the 2nd, the 3rd is processed normally, and the 3rd's log never carries the 2nd's correlationId", async () => {
    const store = new FakeRelayStore();
    const lines: string[] = [];
    const logger = new SecureLogger({ sink: (_level, line) => lines.push(line), now: () => "2026-08-19T10:00:05.000Z" });
    const contextsSeenBySend: Array<string | undefined> = [];

    const deps = {
      store,
      now: () => "2026-08-19T10:00:05.000Z",
      senders: {
        SQS_REMINDER_DISPATCH_V1: async (_payload: Record<string, unknown>) => {
          contextsSeenBySend.push(getContext()?.correlationId);
          if (getContext()?.correlationId === "cor-2") {
            throw new Error("SQS unavailable");
          }
        },
      },
    };

    const records = [
      streamRecord("evt-1", outboxRecord({ eventId: "evt-1", correlationId: "cor-1", SK: "EVENT#...#evt-1" })),
      streamRecord("evt-2", outboxRecord({ eventId: "evt-2", correlationId: "cor-2", SK: "EVENT#...#evt-2", GSI6SK: "x2" })),
      streamRecord("evt-3", outboxRecord({ eventId: "evt-3", correlationId: "cor-3", SK: "EVENT#...#evt-3", GSI6SK: "x3" })),
    ];

    const batchItemFailures = await processStreamRecords(deps, logger, records);

    // (1) only the 2nd record's eventID is reported as a batch item failure.
    expect(batchItemFailures).toEqual([{ itemIdentifier: "evt-2" }]);

    // (2) the 3rd record was processed normally, not aborted by the 2nd's failure.
    expect(contextsSeenBySend).toEqual(["cor-1", "cor-2", "cor-3"]);
    expect(store.published.has("TENANT#t1#OUTBOX#202608#EVENT#...#evt-1")).toBe(true);
    expect(store.published.has("TENANT#t1#OUTBOX#202608#EVENT#...#evt-3")).toBe(true);
    expect(store.published.has("TENANT#t1#OUTBOX#202608#EVENT#...#evt-2")).toBe(false);

    // (3) no log line for the 3rd record carries the 2nd's correlationId (isolation under
    // failure, not just isolation in the happy path already covered by context.test.ts).
    const thirdRecordLines = lines.filter((line) => line.includes('"eventId":"evt-3"'));
    expect(thirdRecordLines.length).toBeGreaterThan(0);
    for (const line of thirdRecordLines) {
      expect(JSON.parse(line).correlationId).toBe("cor-3");
    }

    // The outcome log for the 2nd record (FAILED, since publishOne absorbs the send error
    // into a PublishOutcome rather than throwing - m3.5-runtime-design.md) must carry ITS
    // OWN correlationId, not be contextless.
    const secondRecordOutcomeLine = lines.find((line) => line.includes('"eventId":"evt-2"'));
    expect(secondRecordOutcomeLine).toBeDefined();
    const secondParsed = JSON.parse(secondRecordOutcomeLine!);
    expect(secondParsed.outcome).toBe("FAILED");
    expect(secondParsed.correlationId).toBe("cor-2");
  });
});
