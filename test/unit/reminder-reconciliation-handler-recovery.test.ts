import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryReminderStore } from "./reminder/in-memory-store.js";

const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("../../src/runtime/aws/composition/reminder.js", () => ({ buildReconciliationDeps: mocks.build }));
vi.mock("../../src/shared/dynamodb/client.js", () => ({ createDocumentClient: () => ({}) }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("reconciliation handler selects recovery by deployed scan mode", () => {
  // G-V3: always passing expired candidates into legacy reconciliation strands PAGED work in SCHEDULED.
  it.each(["PAGED", "LEGACY"])("%s uses the intended durable recovery or legacy reversion path", async mode => {
    vi.stubEnv("TABLE_NAME", "test");
    vi.stubEnv("SCAN_MODE", mode);
    const store = new InMemoryReminderStore();
    const candidate = { PK: "TENANT#t1#ITEM#i1", SK: "OCC#o1", tenantId: "t1", entityType: "ReminderOccurrence",
      occurrenceId: "o1", itemId: "i1", itemVersion: 1, policyVersion: 1, status: "CLAIMED", version: 2,
      scheduledAt: "2026-09-16T20:00:00.000Z", claimExpiresAt: "2026-09-16T21:00:00.000Z",
      GSI6PK: "WORKSTATE#CLAIMED", GSI6SK: "expired" };
    await store.update(candidate);
    let id = 0;
    const listStuckScanLeases = vi.fn().mockResolvedValue({ items: [] });
    mocks.build.mockReturnValue({ store, tableName: "test", now: () => "2026-09-16T22:00:00.000Z",
      newEventId: () => `evt-${++id}`, correlationId: () => "handler-recovery",
      candidateSource: { listExpiredClaims: async () => ({ items: [candidate] }), listStuckScanLeases } });
    const { handler } = await import("../../src/runtime/aws/handlers/reminder-reconciliation-handler.js");
    await handler({ mode: "CLAIMS", scheduledTime: "2026-09-16T22:00:00.000Z" });
    expect((await store.get(candidate))?.["status"]).toBe(mode === "PAGED" ? "CLAIMED" : "SCHEDULED");
    expect(store.allItems().filter(x => x["entityType"] === "OutboxEvent")).toHaveLength(mode === "PAGED" ? 1 : 0);
    expect(listStuckScanLeases).toHaveBeenCalledTimes(mode === "PAGED" ? 1 : 0);
  });
});
