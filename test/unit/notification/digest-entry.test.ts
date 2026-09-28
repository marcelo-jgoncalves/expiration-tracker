import { describe, expect, it } from "vitest";
import {
  appendDigestEntryItem,
  digestEntryGsi8Keys,
  digestEntryKey,
  digestEntryPurgeAfterTtl,
  digestFlushAtIso,
  digestWindowDateFromIso,
  isDigestEntryAtCapacity,
  MAX_DIGEST_ITEMS,
  type DigestEntry,
  type DigestEntryItem,
} from "../../../src/modules/notification/domain/digest-entry.js";

const TENANT = "t1";
const RECIPIENT = "user-1";
const WINDOW = "2026-09-27";
const NOW = "2026-09-27T14:00:00.000Z";

function item(overrides: Partial<DigestEntryItem> = {}): DigestEntryItem {
  return { intentId: "intent-1", attemptId: "attempt-1", itemId: "item-1", itemVersion: 1, addedAt: NOW, ...overrides };
}

describe("digestWindowDateFromIso", () => {
  it("returns the UTC calendar date", () => {
    expect(digestWindowDateFromIso("2026-09-27T23:59:59.999Z")).toBe("2026-09-27");
    expect(digestWindowDateFromIso("2026-09-27T00:00:00.000Z")).toBe("2026-09-27");
  });
});

describe("digestFlushAtIso", () => {
  it("is strictly after every instant that falls on windowDate (race-freedom argument in digest-entry.ts's file header)", () => {
    const flushAt = digestFlushAtIso(WINDOW);
    expect(Date.parse(flushAt)).toBeGreaterThan(Date.parse(`${WINDOW}T23:59:59.999Z`));
  });

  it("falls on the calendar day AFTER windowDate, never the same day", () => {
    const flushAt = digestFlushAtIso(WINDOW);
    expect(digestWindowDateFromIso(flushAt)).toBe("2026-09-28");
  });

  it("is deterministic for the same windowDate", () => {
    expect(digestFlushAtIso(WINDOW)).toBe(digestFlushAtIso(WINDOW));
  });
});

describe("digestEntryKey", () => {
  it("embeds tenant, channel, recipient and window - never shares a key across any of those dimensions", () => {
    const key = digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW);
    expect(key.PK).toBe(`TENANT#${TENANT}#DIGEST#WHATSAPP#${RECIPIENT}#${WINDOW}`);
    expect(key.SK).toBe("META");
  });
});

describe("digestEntryGsi8Keys", () => {
  it("uses the WORK#WHATSAPP_DIGEST namespace, ordered by flushAt for the due-scan", () => {
    const keys = digestEntryGsi8Keys({ tenantId: TENANT, recipientUserId: RECIPIENT, flushAt: NOW });
    expect(keys.GSI8PK).toBe("WORK#WHATSAPP_DIGEST");
    expect(keys.GSI8SK).toBe(`${NOW}#TENANT#${TENANT}#${RECIPIENT}`);
  });
});

describe("appendDigestEntryItem", () => {
  it("creates a fresh OPEN entry (version 1) when none existed", () => {
    const entry = appendDigestEntryItem(undefined, { tenantId: TENANT, recipientUserId: RECIPIENT, channel: "WHATSAPP", windowDate: WINDOW, newItem: item(), now: NOW });
    expect(entry.status).toBe("OPEN");
    expect(entry.version).toBe(1);
    expect(entry.items).toEqual([item()]);
    expect(entry.createdAt).toBe(NOW);
    expect(entry.flushAt).toBe(digestFlushAtIso(WINDOW));
  });

  it("appends a new item to an existing entry and increments version", () => {
    const existing: DigestEntry = {
      ...digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW),
      entityType: "DigestEntry",
      tenantId: TENANT,
      recipientUserId: RECIPIENT,
      channel: "WHATSAPP",
      windowDate: WINDOW,
      status: "OPEN",
      items: [item()],
      flushAt: digestFlushAtIso(WINDOW),
      version: 1,
      createdAt: "2026-09-27T09:00:00.000Z",
      updatedAt: "2026-09-27T09:00:00.000Z",
      purgeAfterTtl: digestEntryPurgeAfterTtl(WINDOW),
    };
    const secondItem = item({ intentId: "intent-2", attemptId: "attempt-2", itemId: "item-2" });
    const next = appendDigestEntryItem(existing, { tenantId: TENANT, recipientUserId: RECIPIENT, channel: "WHATSAPP", windowDate: WINDOW, newItem: secondItem, now: NOW });
    expect(next.items).toEqual([item(), secondItem]);
    expect(next.version).toBe(2);
    expect(next.createdAt).toBe(existing.createdAt);
    expect(next.updatedAt).toBe(NOW);
  });

  it("dedupes by intentId - idempotent against a redelivered routing decision for the same intent", () => {
    const existing = appendDigestEntryItem(undefined, { tenantId: TENANT, recipientUserId: RECIPIENT, channel: "WHATSAPP", windowDate: WINDOW, newItem: item(), now: NOW });
    const next = appendDigestEntryItem(existing, { tenantId: TENANT, recipientUserId: RECIPIENT, channel: "WHATSAPP", windowDate: WINDOW, newItem: item(), now: NOW });
    expect(next.items).toHaveLength(1);
    // Version still increments - the caller's OCC-conditioned Update always advances version on
    // a real write, even a no-op-content one; this is not a special "skip the write" path.
    expect(next.version).toBe(2);
  });
});

describe("isDigestEntryAtCapacity", () => {
  it("is false for undefined (no entry yet) and for an entry under the cap", () => {
    expect(isDigestEntryAtCapacity(undefined)).toBe(false);
    const under = appendDigestEntryItem(undefined, { tenantId: TENANT, recipientUserId: RECIPIENT, channel: "WHATSAPP", windowDate: WINDOW, newItem: item(), now: NOW });
    expect(isDigestEntryAtCapacity(under)).toBe(false);
  });

  it("is true once items.length reaches MAX_DIGEST_ITEMS", () => {
    const atCap: DigestEntry = {
      ...digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW),
      entityType: "DigestEntry",
      tenantId: TENANT,
      recipientUserId: RECIPIENT,
      channel: "WHATSAPP",
      windowDate: WINDOW,
      status: "OPEN",
      items: Array.from({ length: MAX_DIGEST_ITEMS }, (_, i) => item({ intentId: `intent-${i}`, attemptId: `attempt-${i}` })),
      flushAt: digestFlushAtIso(WINDOW),
      version: MAX_DIGEST_ITEMS,
      createdAt: NOW,
      updatedAt: NOW,
      purgeAfterTtl: digestEntryPurgeAfterTtl(WINDOW),
    };
    expect(isDigestEntryAtCapacity(atCap)).toBe(true);
  });
});
