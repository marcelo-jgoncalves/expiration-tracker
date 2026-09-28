import { describe, expect, it } from "vitest";
import { runWhatsAppDigestFlushTick, shouldAlarmWhatsAppDigestFlush } from "../../../src/workers/whatsapp-digest-flush/flush.js";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { digestEntryGsi8Keys, digestEntryKey, digestEntryPurgeAfterTtl, digestFlushAtIso, type DigestEntry } from "../../../src/modules/notification/domain/digest-entry.js";
import type { WhatsAppDigestGsi8Candidate, WhatsAppDigestGsi8Page, WhatsAppDigestCandidateSource } from "../../../src/workers/whatsapp-digest-flush/candidate-source.js";
import { buildVersionedUpdate, type EntityKey } from "../../../src/shared/dynamodb/occ.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../../../src/modules/notification/domain/notification-preferences.js";

const TABLE = "test-table";
const TENANT = "tenant-1";
const RECIPIENT = "user-1";
const WINDOW = "2026-09-09";
const NOW = "2026-09-10T00:30:00.000Z"; // past digestFlushAtIso(WINDOW)

function makeEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  const flushAt = digestFlushAtIso(WINDOW);
  return {
    ...digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW),
    entityType: "DigestEntry",
    tenantId: TENANT,
    recipientUserId: RECIPIENT,
    channel: "WHATSAPP",
    windowDate: WINDOW,
    status: "OPEN",
    items: [{ intentId: "intent-1", attemptId: "attempt-1", itemId: "item-1", itemVersion: 1, addedAt: "2026-09-09T12:00:00.000Z" }],
    flushAt,
    version: 1,
    createdAt: "2026-09-09T12:00:00.000Z",
    updatedAt: "2026-09-09T12:00:00.000Z",
    purgeAfterTtl: digestEntryPurgeAfterTtl(WINDOW),
    ...digestEntryGsi8Keys({ tenantId: TENANT, recipientUserId: RECIPIENT, flushAt }),
    ...overrides,
  };
}

function seed(...entries: DigestEntry[]): (Record<string, unknown> & EntityKey)[] {
  return entries as unknown as (Record<string, unknown> & EntityKey)[];
}

/** Fake mirroring the real DynamoDB GSI8 Query's contract - reads live off the same store the
 * worker's transactional writes land in, same discipline `test/unit/reports/scheduler.test.ts`'s
 * fake uses. */
function fakeCandidateSource(store: InMemoryNotificationStore): WhatsAppDigestCandidateSource {
  return {
    async queryDue(input: { before: string }): Promise<WhatsAppDigestGsi8Page> {
      const items: WhatsAppDigestGsi8Candidate[] = store
        .allItems()
        .filter((item): item is EntityKey & Record<string, unknown> => item["entityType"] === "DigestEntry" && typeof item["GSI8SK"] === "string" && (item["GSI8SK"] as string) < input.before)
        .map((item) => {
          const gsi8sk = item["GSI8SK"] as string;
          const entry = item as unknown as DigestEntry;
          return { PK: entry.PK, SK: entry.SK, flushAtIso: gsi8sk.split("#TENANT#")[0]!, tenantId: entry.tenantId, recipientUserId: entry.recipientUserId, windowDate: entry.windowDate };
        })
        .sort((a, b) => a.flushAtIso.localeCompare(b.flushAtIso));
      return { items };
    },
  };
}

function makeDeps(store: InMemoryNotificationStore) {
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

describe("runWhatsAppDigestFlushTick (D-347 §3.5)", () => {
  it("Round 2 Codex review: a recipient currently within quiet hours has the window's flushAt/GSI8 pointer rescheduled forward instead of being claimed", async () => {
    const entry = makeEntry();
    const store = new InMemoryNotificationStore();
    for (const item of seed(entry)) await store.putIfAbsent(item);
    const preferences: NotificationPreferences = {
      ...notificationPreferencesKey(TENANT, RECIPIENT),
      entityType: "NotificationPreferences",
      tenantId: TENANT,
      userId: RECIPIENT,
      emailEnabled: true,
      locale: "pt-BR",
      quietHours: { enabled: true, startLocal: "20:00", endLocal: "08:00", timeZone: "UTC" }, // NOW (00:30 UTC) falls inside this overnight window
      consentSource: "ONBOARDING",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await store.putIfAbsent(preferences);

    const result = await runWhatsAppDigestFlushTick(makeDeps(store));
    expect(result).toEqual({ scanned: 1, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, skippedQuietHours: 1, failed: [], oldestCandidateAgeSeconds: expect.any(Number) });

    const updated = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(updated?.status).toBe("OPEN"); // never claimed
    expect(updated?.flushAt).toBe("2026-09-10T08:00:00.000Z"); // quiet hours end
    expect((updated as unknown as Record<string, unknown>)["GSI8SK"]).toBe(`2026-09-10T08:00:00.000Z#TENANT#${TENANT}#${RECIPIENT}`);
    expect(store.allItems().some((i) => i["entityType"] === "OutboxEvent")).toBe(false);
  });

  it("claims a due DigestEntry: marks it FLUSHED, drops its GSI8 pointer, writes a durable outbox event", async () => {
    const entry = makeEntry();
    const store = new InMemoryNotificationStore();
    for (const item of seed(entry)) await store.putIfAbsent(item);

    const result = await runWhatsAppDigestFlushTick(makeDeps(store));
    expect(result).toEqual({ scanned: 1, claimed: 1, skippedConcurrentlyModified: 0, skippedNotDue: 0, skippedQuietHours: 0, failed: [], oldestCandidateAgeSeconds: expect.any(Number) });

    const updated = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(updated?.status).toBe("FLUSHED");
    expect(updated?.version).toBe(2);
    expect((updated as unknown as Record<string, unknown>)["GSI8PK"]).toBeUndefined();

    const outboxRecords = store.allItems().filter((item) => item["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(1);
    const record = outboxRecords[0] as unknown as { destination: string; eventType: string; payload: { tenantId: string; recipientUserId: string; windowDate: string; items: unknown[] } };
    expect(record.destination).toBe("SQS_NOTIFICATION_WHATSAPP_DIGEST_V1");
    expect(record.eventType).toBe("WhatsAppDigestFlushRequested");
    expect(record.payload.tenantId).toBe(TENANT);
    expect(record.payload.recipientUserId).toBe(RECIPIENT);
    expect(record.payload.windowDate).toBe(WINDOW);
    expect(record.payload.items).toEqual(entry.items);
  });

  it("never touches a window whose flushAt is still in the future - the GSI8 query's own GSI8SK < before filter excludes it", async () => {
    const futureWindow = "2026-09-10";
    const entry = makeEntry({ windowDate: futureWindow, ...digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", futureWindow), flushAt: digestFlushAtIso(futureWindow), ...digestEntryGsi8Keys({ tenantId: TENANT, recipientUserId: RECIPIENT, flushAt: digestFlushAtIso(futureWindow) }) });
    const store = new InMemoryNotificationStore();
    for (const item of seed(entry)) await store.putIfAbsent(item);

    const result = await runWhatsAppDigestFlushTick(makeDeps(store));
    expect(result).toEqual({ scanned: 0, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, skippedQuietHours: 0, failed: [], oldestCandidateAgeSeconds: undefined });
  });

  it("skips (never throws) a window concurrently claimed by another tick since the GSI8 query observed it", async () => {
    const entry = makeEntry();
    const store = new InMemoryNotificationStore();
    for (const item of seed(entry)) await store.putIfAbsent(item);
    const realTransactWrite = store.transactWrite.bind(store);
    let callCount = 0;
    store.transactWrite = async (entries) => {
      callCount += 1;
      if (callCount === 1) {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }] };
      }
      return realTransactWrite(entries);
    };

    const result = await runWhatsAppDigestFlushTick(makeDeps(store));
    expect(result).toEqual({ scanned: 1, claimed: 0, skippedConcurrentlyModified: 1, skippedNotDue: 0, skippedQuietHours: 0, failed: [], oldestCandidateAgeSeconds: expect.any(Number) });
  });

  it("skips a candidate already FLUSHED by a concurrent claim between the query and this worker's fresh read, never double-claiming it", async () => {
    const entry = makeEntry();
    const store = new InMemoryNotificationStore();
    for (const item of seed(entry)) await store.putIfAbsent(item);

    // Concurrent winner: a prior tick already claimed this window.
    const claim = buildVersionedUpdate({
      tableName: TABLE,
      key: digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW),
      tenantId: TENANT,
      expectedVersion: entry.version,
      set: { status: "FLUSHED" },
      remove: ["GSI8PK", "GSI8SK"],
    });
    await store.transactWrite([{ Update: claim }]);

    // A real GSI8 Query is eventually consistent - pin the candidate source to the stale
    // pre-claim pointer directly, same technique scheduler.test.ts uses.
    const staleCandidates: WhatsAppDigestCandidateSource = {
      async queryDue() {
        return { items: [{ PK: entry.PK, SK: entry.SK, flushAtIso: entry.flushAt, tenantId: TENANT, recipientUserId: RECIPIENT, windowDate: WINDOW }] };
      },
    };

    const result = await runWhatsAppDigestFlushTick({ ...makeDeps(store), candidates: staleCandidates });
    expect(result).toEqual({ scanned: 1, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 1, skippedQuietHours: 0, failed: [], oldestCandidateAgeSeconds: expect.any(Number) });
    const updated = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(updated?.version).toBe(2); // never clobbered by the stale candidate.
  });
});

describe("shouldAlarmWhatsAppDigestFlush", () => {
  it("alarms when any window failed to claim", () => {
    expect(shouldAlarmWhatsAppDigestFlush({ scanned: 1, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, skippedQuietHours: 0, failed: [{ tenantId: "t", recipientUserId: "r", error: new Error("x") }], oldestCandidateAgeSeconds: undefined }).alarm).toBe(true);
  });

  it("never alarms on a clean tick", () => {
    expect(shouldAlarmWhatsAppDigestFlush({ scanned: 0, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, skippedQuietHours: 0, failed: [], oldestCandidateAgeSeconds: undefined }).alarm).toBe(false);
  });
});
