import { describe, expect, it } from "vitest";
import { buildDigestEntryWriteEntry } from "../../../src/modules/notification/application/whatsapp-digest-entry-writer.js";
import { digestEntryKey, digestEntryPurgeAfterTtl, digestFlushAtIso, type DigestEntry } from "../../../src/modules/notification/domain/digest-entry.js";

const TENANT = "t1";
const RECIPIENT = "user-1";
const WINDOW = "2026-09-27";
const NOW = "2026-09-27T14:00:00.000Z";
const TABLE = "MainTable";

describe("buildDigestEntryWriteEntry (D-347 §3.5)", () => {
  it("builds a Put-if-absent entry when no existing DigestEntry is given", () => {
    const entry = buildDigestEntryWriteEntry({
      tableName: TABLE,
      tenantId: TENANT,
      recipientUserId: RECIPIENT,
      windowDate: WINDOW,
      existing: undefined,
      newItem: { intentId: "intent-1", attemptId: "attempt-1", itemId: "item-1", itemVersion: 1, addedAt: NOW },
      now: NOW,
    });
    expect("Put" in entry).toBe(true);
    if (!("Put" in entry)) throw new Error("unreachable");
    expect(entry.Put.ConditionExpression).toBe("attribute_not_exists(PK) AND attribute_not_exists(SK)");
    expect(entry.Put.Item["items"]).toEqual([{ intentId: "intent-1", attemptId: "attempt-1", itemId: "item-1", itemVersion: 1, addedAt: NOW }]);
    expect(entry.Put.Item["GSI8PK"]).toBe("WORK#WHATSAPP_DIGEST");
    expect(entry.Put.Item["flushAt"]).toBe(digestFlushAtIso(WINDOW));
  });

  it("builds a versioned Update entry when an existing DigestEntry is given, OCC-fenced on its version", () => {
    const existing: DigestEntry = {
      ...digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW),
      entityType: "DigestEntry",
      tenantId: TENANT,
      recipientUserId: RECIPIENT,
      channel: "WHATSAPP",
      windowDate: WINDOW,
      status: "OPEN",
      items: [{ intentId: "intent-1", attemptId: "attempt-1", itemId: "item-1", itemVersion: 1, addedAt: "2026-09-27T09:00:00.000Z" }],
      flushAt: digestFlushAtIso(WINDOW),
      version: 3,
      createdAt: "2026-09-27T09:00:00.000Z",
      updatedAt: "2026-09-27T09:00:00.000Z",
      purgeAfterTtl: digestEntryPurgeAfterTtl(WINDOW),
    };
    const entry = buildDigestEntryWriteEntry({
      tableName: TABLE,
      tenantId: TENANT,
      recipientUserId: RECIPIENT,
      windowDate: WINDOW,
      existing,
      newItem: { intentId: "intent-2", attemptId: "attempt-2", itemId: "item-2", itemVersion: 1, addedAt: NOW },
      now: NOW,
    });
    expect("Update" in entry).toBe(true);
    if (!("Update" in entry)) throw new Error("unreachable");
    expect(entry.Update.ExpressionAttributeValues[":expectedVersion"]).toBe(3);
    expect(entry.Update.Key).toEqual(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
  });
});
