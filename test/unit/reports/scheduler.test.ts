import { describe, expect, it } from "vitest";
import { runScheduledReportsTick, shouldAlarmScheduledReports } from "../../../src/workers/scheduled-reports/scheduler.js";
import { InMemoryReportSubscriptionStore } from "./in-memory-store.js";
import { reportSubscriptionGsi8Keys, reportSubscriptionKey, type ReportSubscription } from "../../../src/modules/reports/domain/report-subscription.js";
import type { ReportSubscriptionGsi8Candidate, ReportSubscriptionGsi8Page, ScheduledReportsCandidateSource } from "../../../src/workers/scheduled-reports/candidate-source.js";
import { buildVersionedUpdate, type EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TABLE = "test-table";
const TENANT = "tenant-1";
const NOW = "2026-09-09T10:00:00.000Z"; // Wednesday.

function makeSubscription(overrides: Partial<ReportSubscription> = {}): ReportSubscription {
  const subscriptionId = overrides.subscriptionId ?? "sub-1";
  const tenantId = overrides.tenantId ?? TENANT;
  const nextRunAt = overrides.nextRunAt ?? "2026-09-09T09:00:00.000Z"; // in the past relative to NOW, by default
  return {
    ...reportSubscriptionKey(tenantId, subscriptionId),
    entityType: "ReportSubscription",
    subscriptionId,
    tenantId,
    reportTypes: ["EXPIRED_ITEMS"],
    cadence: "WEEKLY",
    dayOfWeek: 3, // Wednesday, ISO convention.
    localTime: "09:00",
    timeZone: "UTC",
    recipientUserIds: ["user-1"],
    createdBy: "user-1",
    nextRunAt,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...reportSubscriptionGsi8Keys({ dueAtIso: nextRunAt, tenantId, subscriptionId }),
    ...overrides,
  };
}

function seed(...subscriptions: ReportSubscription[]): (Record<string, unknown> & EntityKey)[] {
  return subscriptions as unknown as (Record<string, unknown> & EntityKey)[];
}

/** Fake mirroring the real DynamoDB GSI8 Query's contract - reads live off the same store the
 * worker's transactional writes land in, same discipline `requirement-reindex.test.ts`'s fake
 * uses. */
function fakeCandidateSource(store: InMemoryReportSubscriptionStore): ScheduledReportsCandidateSource {
  return {
    async queryDue(input: { before: string }): Promise<ReportSubscriptionGsi8Page> {
      const items: ReportSubscriptionGsi8Candidate[] = store
        .allItems()
        .filter((item): item is EntityKey & Record<string, unknown> => item["entityType"] === "ReportSubscription" && typeof item["GSI8SK"] === "string" && (item["GSI8SK"] as string) < input.before)
        .map((item) => {
          const gsi8sk = item["GSI8SK"] as string;
          const subscription = item as unknown as ReportSubscription;
          return { PK: subscription.PK, SK: subscription.SK, dueAtIso: gsi8sk.split("#TENANT#")[0]!, tenantId: subscription.tenantId, subscriptionId: subscription.subscriptionId };
        })
        .sort((a, b) => a.dueAtIso.localeCompare(b.dueAtIso));
      return { items };
    },
  };
}

function makeDeps(store: InMemoryReportSubscriptionStore) {
  let counter = 0;
  return {
    store,
    candidates: fakeCandidateSource(store),
    tableName: TABLE,
    now: () => NOW,
    newEventId: () => `evt-${++counter}`,
    correlationId: () => "corr-1",
  };
}

describe("runScheduledReportsTick (D-211 fatia 2, D-204 decisions 3-4)", () => {
  it("claims a due subscription: advances nextRunAt/GSI8 pointer and writes a durable outbox event", async () => {
    const subscription = makeSubscription();
    const store = new InMemoryReportSubscriptionStore(seed(subscription));

    const result = await runScheduledReportsTick(makeDeps(store));
    expect(result).toEqual({ scanned: 1, claimed: 1, skippedConcurrentlyModified: 0, skippedNotDue: 0, failed: [], oldestCandidateAgeSeconds: expect.any(Number) });

    const updated = await store.get<ReportSubscription>(reportSubscriptionKey(TENANT, subscription.subscriptionId));
    expect(updated?.version).toBe(2);
    expect(updated?.nextRunAt).toBe("2026-09-16T09:00:00.000Z"); // next Wednesday 09:00 UTC.
    expect(updated?.GSI8SK).toBe(`2026-09-16T09:00:00.000Z#TENANT#${TENANT}#${subscription.subscriptionId}`);

    const outboxRecords = store.allItems().filter((item) => item["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(1);
    const record = outboxRecords[0] as unknown as { destination: string; eventType: string; payload: { runId: string; subscriptionId: string; tenantId: string; scheduledFor: string } };
    expect(record.destination).toBe("SQS_REPORT_SUBSCRIPTION_DELIVERY_V1");
    expect(record.eventType).toBe("ReportSubscriptionRunRequested");
    expect(record.payload.subscriptionId).toBe(subscription.subscriptionId);
    expect(record.payload.tenantId).toBe(TENANT);
    expect(record.payload.scheduledFor).toBe("2026-09-09T09:00:00.000Z");
    expect(record.payload.runId).toBeTruthy();
  });

  it("never touches a subscription whose nextRunAt is still in the future - the GSI8 query's own GSI8SK < before filter excludes it", async () => {
    const subscription = makeSubscription({ nextRunAt: "2026-09-16T09:00:00.000Z" });
    const store = new InMemoryReportSubscriptionStore(seed({ ...subscription, ...reportSubscriptionGsi8Keys({ dueAtIso: subscription.nextRunAt, tenantId: TENANT, subscriptionId: subscription.subscriptionId }) }));

    const result = await runScheduledReportsTick(makeDeps(store));
    expect(result).toEqual({ scanned: 0, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, failed: [], oldestCandidateAgeSeconds: undefined });
  });

  it("processes multiple due subscriptions across tenants in one run", async () => {
    const s1 = makeSubscription({ subscriptionId: "sub-1", tenantId: "tenant-a" });
    const s2 = makeSubscription({ subscriptionId: "sub-2", tenantId: "tenant-b" });
    const store = new InMemoryReportSubscriptionStore(seed(s1, s2));

    const result = await runScheduledReportsTick(makeDeps(store));
    expect(result.scanned).toBe(2);
    expect(result.claimed).toBe(2);
  });

  it("skips (never throws) a subscription concurrently claimed by another tick since the GSI8 query observed it", async () => {
    const subscription = makeSubscription();
    const store = new InMemoryReportSubscriptionStore(seed(subscription));
    const realTransactWrite = store.transactWrite.bind(store);
    let callCount = 0;
    store.transactWrite = async (entries) => {
      callCount += 1;
      if (callCount === 1) {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] };
      }
      return realTransactWrite(entries);
    };

    const result = await runScheduledReportsTick(makeDeps(store));
    expect(result).toEqual({ scanned: 1, claimed: 0, skippedConcurrentlyModified: 1, skippedNotDue: 0, failed: [], oldestCandidateAgeSeconds: expect.any(Number) });
  });

  it("skips a candidate whose nextRunAt was pushed forward by a concurrent claim between the query and this worker's fresh read, never double-claiming it", async () => {
    const subscription = makeSubscription();
    const store = new InMemoryReportSubscriptionStore(seed(subscription));

    // Concurrent winner: a prior tick already claimed this subscription, advancing nextRunAt
    // into the future, before this worker's own read.
    const nextRunAt = "2026-09-16T09:00:00.000Z";
    const claim = buildVersionedUpdate({
      tableName: TABLE,
      key: reportSubscriptionKey(TENANT, subscription.subscriptionId),
      tenantId: TENANT,
      expectedVersion: subscription.version,
      set: { nextRunAt, ...reportSubscriptionGsi8Keys({ dueAtIso: nextRunAt, tenantId: TENANT, subscriptionId: subscription.subscriptionId }) },
    });
    await store.transactWrite([{ Update: claim }]);

    // A real GSI8 Query is eventually consistent - pin the candidate source to the stale
    // pre-claim pointer directly, same technique requirement-reindex.test.ts uses.
    const staleCandidates: ScheduledReportsCandidateSource = {
      async queryDue() {
        return { items: [{ PK: subscription.PK, SK: subscription.SK, dueAtIso: subscription.nextRunAt, tenantId: TENANT, subscriptionId: subscription.subscriptionId }] };
      },
    };

    const result = await runScheduledReportsTick({ ...makeDeps(store), candidates: staleCandidates });
    expect(result).toEqual({ scanned: 1, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 1, failed: [], oldestCandidateAgeSeconds: expect.any(Number) });
    const updated = await store.get<ReportSubscription>(reportSubscriptionKey(TENANT, subscription.subscriptionId));
    expect(updated?.version).toBe(2); // never clobbered by the stale candidate.
  });
});

describe("shouldAlarmScheduledReports", () => {
  it("alarms when any subscription failed to claim", () => {
    expect(shouldAlarmScheduledReports({ scanned: 1, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, failed: [{ subscriptionId: "s", tenantId: "t", error: new Error("x") }], oldestCandidateAgeSeconds: undefined }).alarm).toBe(true);
  });

  it("never alarms on a clean tick", () => {
    expect(shouldAlarmScheduledReports({ scanned: 0, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, failed: [], oldestCandidateAgeSeconds: undefined }).alarm).toBe(false);
  });
});
