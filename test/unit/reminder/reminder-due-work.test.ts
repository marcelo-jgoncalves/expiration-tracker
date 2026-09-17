import { describe, expect, it } from "vitest";
import { buildReminderDueWorkItem, dueWorkPartition, dueWorkSortKey, dueWorkUpperBound } from "../../../src/modules/reminder/domain/reminder-due-work.js";

describe("ReminderDueWork", () => {
  it("uses minute/generation/shard partition and time-first sort key", () => {
    expect(dueWorkPartition({ shardFnVersion: 2, shardId: 17, scheduledAt: "2026-09-17T18:49:55.123Z" }))
      .toBe("DUE#v2#s17#m2026-09-17T18:49:00.000Z");
    expect(dueWorkSortKey({ scheduledAt: "2026-09-17T18:49:55.123Z", entityKind: "REMINDER", tenantId: "t1", occurrenceId: "o1" }))
      .toBe("AT#2026-09-17T18:49:55.123Z#K#REMINDER#T#t1#I#o1");
  });

  it("the observed-now upper bound includes every item at now and excludes future work", () => {
    const now = "2026-09-17T18:49:10.000Z";
    const bound = dueWorkUpperBound(now);
    expect(dueWorkSortKey({ scheduledAt: now, entityKind: "REMINDER", tenantId: "z", occurrenceId: "z" }) <= bound).toBe(true);
    expect(dueWorkSortKey({ scheduledAt: "2026-09-17T18:49:10.001Z", entityKind: "REMINDER", tenantId: "a", occurrenceId: "a" }) > bound).toBe(true);
  });

  it("builds a self-contained pointer to the authoritative occurrence", () => {
    const item = buildReminderDueWorkItem({
      entityKind: "CHASING", tenantId: "t1", occurrenceId: "o1",
      occurrenceKey: { PK: "TENANT#t1#SUBJECT#s1", SK: "CHASING#o1" },
      scheduledAt: "2026-09-17T18:49:10.000Z", shardFnVersion: 2, shardId: 17,
      now: "2026-09-01T00:00:00.000Z", purgeAfterTtl: 1_800_000_000,
    });
    expect(item).toMatchObject({ entityType: "REMINDER_DUE_WORK", entityKind: "CHASING", occurrencePK: "TENANT#t1#SUBJECT#s1", occurrenceSK: "CHASING#o1" });
  });

  it("rejects non-canonical timestamps so lexical ordering remains safe", () => {
    expect(() => dueWorkUpperBound("2026-09-17 18:49:10Z")).toThrow(/canonical/);
  });
});
