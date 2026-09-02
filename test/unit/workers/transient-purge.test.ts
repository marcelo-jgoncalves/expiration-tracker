import { describe, expect, it } from "vitest";
import { runTransientPurge, isWebhookInboxPurgeEligible, isUploadSlotPurgeEligible, WEBHOOK_INBOX_RETENTION_DAYS } from "../../../src/workers/transient-purge/purge.js";
import { transientPurgeGsi8Keys } from "../../../src/shared/transient-purge-gsi8.js";
import { FakeTransientPurgeCandidateSource } from "./transient-purge-fakes.js";
import type { WebhookInboxPurgeCandidate, UploadSlotPurgeCandidate } from "../../../src/workers/transient-purge/candidate-source.js";

const TABLE = "test-table";
const NOW = "2026-09-01T00:00:00.000Z";

function makeWebhookInbox(overrides: Partial<WebhookInboxPurgeCandidate> = {}): WebhookInboxPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#WEBHOOK#SES#acct-1`,
    SK: "EVENT#sns-1",
    entityType: "WebhookInbox",
    tenantId,
    createdAt: "2026-08-01T00:00:00.000Z", // well over 7 days before NOW - eligible
    version: 1,
    ...overrides,
  };
}

function makeUploadSlot(overrides: Partial<UploadSlotPurgeCandidate> = {}): UploadSlotPurgeCandidate {
  const tenantId = overrides.tenantId ?? "tenant-1";
  return {
    PK: `TENANT#${tenantId}#UPLOAD`,
    SK: "SLOT#slot-1",
    entityType: "UploadSlot",
    tenantId,
    reservedAt: "2026-08-01T00:00:00.000Z", // well over both windows before NOW
    status: "EXPIRED",
    version: 1,
    ...overrides,
  };
}

describe("runTransientPurge (D-156: WebhookInbox createdAt+7d, UploadSlot reservedAt+7d/24h, ACTIVE tenants only / D-179/D-188 MaintenanceDueIndex slice 7)", () => {
  it("purges a WebhookInbox row older than 7 days in an ACTIVE tenant", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(result.quarantinedCount).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never surfaces a WebhookInbox row younger than 7 days as a candidate at all (GSI8 is due-ordered)", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeWebhookInbox({ createdAt: "2026-08-28T00:00:00.000Z" }); // ~4 days before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is boundary-inclusive for WebhookInbox: createdAt+7d == now is eligible, +7d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - WEBHOOK_INBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isWebhookInboxPurgeEligible(exactlyAtBoundary, NOW)).toBe(true);
    expect(isWebhookInboxPurgeEligible(oneMsShort, NOW)).toBe(false);
  });

  it("never seeds a GSI8 pointer for a RESERVED UploadSlot (never a candidate at all, not even scanned)", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeUploadSlot({ status: "RESERVED", reservedAt: "2020-01-01T00:00:00.000Z" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBeUndefined();
    expect(stored?.["GSI8SK"]).toBeUndefined();

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("purges an EXPIRED (never-confirmed) UploadSlot 24h after reservedAt", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    // GSI8's own `queryDue` uses a strict `GSI8SK < :before` (same as every other migrated
    // worker) - a due date exactly equal to `now` is not yet surfaced, so this uses a reservedAt
    // safely (not exactly) past the 24h boundary; boundary-inclusivity itself is proven directly
    // against isUploadSlotPurgeEligible below, same split as isWebhookInboxPurgeEligible's own
    // boundary test above.
    const candidate = makeUploadSlot({ status: "EXPIRED", reservedAt: "2026-08-30T00:00:00.000Z" }); // well over 24h before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never surfaces an EXPIRED UploadSlot less than 24h after reservedAt as a candidate", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeUploadSlot({ status: "EXPIRED", reservedAt: "2026-08-31T01:00:00.000Z" }); // 23h before NOW
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("holds a CONSUMED (confirmed) UploadSlot to the full 7-day window, not the 24h incomplete window", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    // 2 days before NOW: past the 24h incomplete window, well short of the 7-day confirmed window.
    const candidate = makeUploadSlot({ status: "CONSUMED", reservedAt: "2026-08-30T00:00:00.000Z" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(0);
    expect(result.purged).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("purges a CONSUMED UploadSlot once its full 7-day window has passed", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeUploadSlot({ status: "CONSUMED", reservedAt: "2026-08-01T00:00:00.000Z" });
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("is boundary-inclusive for an EXPIRED UploadSlot: reservedAt+24h == now is eligible, +24h-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isUploadSlotPurgeEligible({ status: "EXPIRED", reservedAt: exactlyAtBoundary }, NOW)).toBe(true);
    expect(isUploadSlotPurgeEligible({ status: "EXPIRED", reservedAt: oneMsShort }, NOW)).toBe(false);
  });

  it("RELEASED UploadSlot follows the incomplete (24h) window, same as EXPIRED", () => {
    expect(isUploadSlotPurgeEligible({ status: "RELEASED", reservedAt: "2026-08-31T00:00:00.000Z" }, NOW)).toBe(true);
    expect(isUploadSlotPurgeEligible({ status: "RELEASED", reservedAt: "2026-08-31T01:00:00.000Z" }, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a candidate in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job) and increments the retry counter",
    async (status) => {
      const candidates = new FakeTransientPurgeCandidateSource();
      const candidate = makeWebhookInbox();
      candidates.seed(candidate);
      candidates.setTenantStatus(candidate.tenantId, status);

      const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

      expect(result).toMatchObject({ scanned: 1, purged: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0, quarantinedCount: 0 });
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
      expect(stored).toBeDefined();
      expect(stored?.["maintenanceAttemptCount"]).toBe(1);
      expect(stored?.["GSI8PK"]).toBe("WORK#TRANSIENT"); // still in WORK namespace, not DLQ yet
    },
  );

  it("never purges a candidate whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeTransientPurgeCandidateSource(); // no setTenantStatus call - tenant genuinely missing
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a candidate whose version changed between the GSI8 query and the claim is never purged", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2;
      return realTransactWrite(entries);
    };

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(0);
    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.skippedTenantNotActive).toBe(0);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("conditional-delete guard: a row deleted between the GSI8 query and the claim (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const realTransactWrite = candidates.transactWrite.bind(candidates);
    candidates.transactWrite = (entries) => {
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realTransactWrite(entries);
    };

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "ACTIVE");

    const first = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(second.scanned).toBe(0);
    expect(second.purged).toBe(0);
  });

  it("processes a mix of WebhookInbox/UploadSlot candidates across tenants in one run and touches ONLY the ones GSI8 actually surfaces", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    candidates.setTenantStatus("tenant-active", "ACTIVE");
    candidates.setTenantStatus("tenant-closing", "DELETING");

    const eligibleInbox = makeWebhookInbox({ tenantId: "tenant-active", PK: "TENANT#tenant-active#WEBHOOK#SES#acct-1", SK: "EVENT#sns-1" });
    const tooRecentInbox = makeWebhookInbox({
      tenantId: "tenant-active",
      PK: "TENANT#tenant-active#WEBHOOK#SES#acct-1",
      SK: "EVENT#sns-2",
      createdAt: "2026-08-28T00:00:00.000Z",
    });
    const reservedSlot = makeUploadSlot({ tenantId: "tenant-active", PK: "TENANT#tenant-active#UPLOAD", SK: "SLOT#slot-reserved", status: "RESERVED" });
    const nonActiveTenantInbox = makeWebhookInbox({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#WEBHOOK#SES#acct-1", SK: "EVENT#sns-3" });
    candidates.seed(eligibleInbox);
    candidates.seed(tooRecentInbox);
    candidates.seed(reservedSlot);
    candidates.seed(nonActiveTenantInbox);

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    // tooRecentInbox/reservedSlot never appear in GSI8's `GSI8SK < now` query at all (reservedSlot
    // never even gets a pointer) - not "scanned and skipped".
    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.skippedTenantNotActive).toBe(1);
    expect(candidates.get({ PK: eligibleInbox.PK, SK: eligibleInbox.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecentInbox.PK, SK: tooRecentInbox.SK })).toBeDefined();
    expect(candidates.get({ PK: reservedSlot.PK, SK: reservedSlot.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenantInbox.PK, SK: nonActiveTenantInbox.SK })).toBeDefined();
  });

  it("drains multiple GSI8 pages within one run", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    candidates.pageSize = 1;
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    const a = makeWebhookInbox({ PK: "TENANT#tenant-1#WEBHOOK#SES#acct-1", SK: "EVENT#sns-1" });
    const b = makeUploadSlot({ PK: "TENANT#tenant-1#UPLOAD", SK: "SLOT#slot-1", status: "EXPIRED" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });

  it("reports the age of the oldest due candidate without extra I/O", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    candidates.setTenantStatus("tenant-1", "ACTIVE");
    // createdAt+7d = 2026-08-25T00:00:00.000Z, which is 7 days (604800s) before NOW.
    candidates.seed(makeWebhookInbox({ createdAt: "2026-08-18T00:00:00.000Z" }));

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.oldestCandidateAgeSeconds).toBe(7 * 24 * 60 * 60);
  });

  it("reports undefined oldestCandidateAgeSeconds when there is nothing due", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });
    expect(result.oldestCandidateAgeSeconds).toBeUndefined();
  });

  // D-179 §8 poison-record handling, same as every other tenant-fenced migrated worker.
  it("quarantines a candidate to the DLQ namespace after MAX_ATTEMPTS failed tenant-ACTIVE revalidations", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    candidates.setTenantStatus(candidate.tenantId, "BLOCKED");

    let now = Date.parse(NOW);
    let last;
    for (let i = 0; i < 6; i++) {
      now += 20 * 24 * 60 * 60 * 1000; // 20 days - comfortably past the largest (16d) backoff step
      const nowIso = new Date(now).toISOString();
      last = await runTransientPurge({ candidates, tableName: TABLE, now: () => nowIso });
    }

    const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK });
    expect(stored?.["GSI8PK"]).toBe("DLQ#TRANSIENT");
    expect(stored?.["maintenanceAttemptCount"]).toBe(6);
    expect(last!.quarantinedCount).toBe(1);
    const after = await runTransientPurge({ candidates, tableName: TABLE, now: () => new Date(now + 1000).toISOString() });
    expect(after.scanned).toBe(0);
  });

  it("cross-tenant isolation: exhausting/quarantining one tenant's candidate never touches another tenant's row", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const blocked = makeWebhookInbox({ tenantId: "tenant-blocked", PK: "TENANT#tenant-blocked#WEBHOOK#SES#acct-1" });
    const active = makeWebhookInbox({ tenantId: "tenant-active", PK: "TENANT#tenant-active#WEBHOOK#SES#acct-1" });
    candidates.seed(blocked);
    candidates.seed(active);
    candidates.setTenantStatus("tenant-blocked", "BLOCKED");
    candidates.setTenantStatus("tenant-active", "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: blocked.PK, SK: blocked.SK })).toBeDefined();
    expect(candidates.get({ PK: active.PK, SK: active.SK })).toBeUndefined();
  });

  it("self-heals a stale/malformed GSI8 pointer left on a RESERVED UploadSlot (defensive only — no real writer produces this)", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const tenantId = "tenant-1";
    const slot: UploadSlotPurgeCandidate = {
      PK: `TENANT#${tenantId}#UPLOAD`,
      SK: "SLOT#slot-stale",
      entityType: "UploadSlot",
      tenantId,
      reservedAt: "2020-01-01T00:00:00.000Z",
      status: "RESERVED",
      version: 1,
      ...transientPurgeGsi8Keys({ dueAtIso: "2020-01-08T00:00:00.000Z", tenantId, entityType: "UploadSlot", sk: "SLOT#slot-stale" }),
    };
    candidates.seedRaw(slot as unknown as Record<string, unknown> & { PK: string; SK: string });
    candidates.setTenantStatus(tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(1);
    expect(result.purged).toBe(0);
    expect(result.skippedStalePointer).toBe(1);
    const stored = candidates.get({ PK: slot.PK, SK: slot.SK });
    expect(stored).toBeDefined();
    expect(stored?.["GSI8PK"]).toBeUndefined();
    expect(stored?.["GSI8SK"]).toBeUndefined();
  });
});
