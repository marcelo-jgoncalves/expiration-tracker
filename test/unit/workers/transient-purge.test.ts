import { describe, expect, it } from "vitest";
import {
  runTransientPurge,
  isWebhookInboxPurgeEligible,
  isUploadSlotPurgeEligible,
  WEBHOOK_INBOX_RETENTION_DAYS,
} from "../../../src/workers/transient-purge/purge.js";
import { FakeTransientPurgeCandidateSource, FakeTenantLifecycleStatusSource } from "./transient-purge-fakes.js";
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

describe("runTransientPurge (D-156: WebhookInbox createdAt+7d, UploadSlot reservedAt+7d/24h, ACTIVE tenants only)", () => {
  it("purges a WebhookInbox row older than 7 days in an ACTIVE tenant", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 1, skippedTooRecent: 0, skippedActiveUploadSlot: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never purges a WebhookInbox row younger than 7 days", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeWebhookInbox({ createdAt: "2026-08-28T00:00:00.000Z" }); // ~4 days before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedActiveUploadSlot: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("is boundary-inclusive for WebhookInbox: createdAt+7d == now is eligible, +7d-1ms is not", () => {
    const exactlyAtBoundary = new Date(Date.parse(NOW) - WEBHOOK_INBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oneMsShort = new Date(Date.parse(exactlyAtBoundary) + 1).toISOString();
    expect(isWebhookInboxPurgeEligible(exactlyAtBoundary, NOW)).toBe(true);
    expect(isWebhookInboxPurgeEligible(oneMsShort, NOW)).toBe(false);
  });

  it("never purges a RESERVED UploadSlot regardless of age (still an active, in-flight reservation)", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeUploadSlot({ status: "RESERVED", reservedAt: "2020-01-01T00:00:00.000Z" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedActiveUploadSlot: 1, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("purges an EXPIRED (never-confirmed) UploadSlot 24h after reservedAt", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeUploadSlot({ status: "EXPIRED", reservedAt: "2026-08-31T00:00:00.000Z" }); // exactly 24h before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("never purges an EXPIRED UploadSlot less than 24h after reservedAt", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeUploadSlot({ status: "EXPIRED", reservedAt: "2026-08-31T01:00:00.000Z" }); // 23h before NOW
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedActiveUploadSlot: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("holds a CONSUMED (confirmed) UploadSlot to the full 7-day window, not the 24h incomplete window", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    // 2 days before NOW: past the 24h incomplete window, well short of the 7-day confirmed window.
    const candidate = makeUploadSlot({ status: "CONSUMED", reservedAt: "2026-08-30T00:00:00.000Z" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 1, skippedActiveUploadSlot: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
  });

  it("purges a CONSUMED UploadSlot once its full 7-day window has passed", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeUploadSlot({ status: "CONSUMED", reservedAt: "2026-08-01T00:00:00.000Z" });
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.purged).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("RELEASED UploadSlot follows the incomplete (24h) window, same as EXPIRED", () => {
    expect(isUploadSlotPurgeEligible({ status: "RELEASED", reservedAt: "2026-08-31T00:00:00.000Z" }, NOW)).toBe(true);
    expect(isUploadSlotPurgeEligible({ status: "RELEASED", reservedAt: "2026-08-31T01:00:00.000Z" }, NOW)).toBe(false);
  });

  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"])(
    "never purges a candidate in a tenant whose lifecycle status is %s (that's the tenant-purge pipeline's job)",
    async (status) => {
      const candidates = new FakeTransientPurgeCandidateSource();
      const lifecycle = new FakeTenantLifecycleStatusSource();
      const candidate = makeWebhookInbox();
      candidates.seed(candidate);
      lifecycle.setStatus(candidate.tenantId, status);

      const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

      expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedActiveUploadSlot: 0, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
      expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    },
  );

  it("never purges a candidate whose tenant has NO lifecycle record at all (fail-closed, never assumed ACTIVE)", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource(); // no setStatus call - tenant genuinely missing
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedTenantNotActive).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("conditional-delete guard: a candidate whose version changed between scan and delete is never purged", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    // Simulate a concurrent write racing this worker: version bumps on the underlying row AFTER
    // the scan already produced `candidate`, but BEFORE this worker's delete call fires - wired
    // into deleteCandidate itself, exactly where the real race window is.
    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      const stored = candidates.get({ PK: candidate.PK, SK: candidate.SK })!;
      (stored as Record<string, unknown>)["version"] = 2;
      return realDelete(input);
    };

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 1, purged: 0, skippedTooRecent: 0, skippedActiveUploadSlot: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 1 });
    // The record is untouched, not silently deleted despite the race. Confirming the guard is
    // load-bearing: reverting the simulated race (deleting again with the original version)
    // succeeds, proving the earlier failure was really the condition, not an unrelated bug.
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeDefined();
    (candidates.get({ PK: candidate.PK, SK: candidate.SK }) as Record<string, unknown>)["version"] = 1;
    candidates.deleteCandidate = realDelete;
    const second = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second.purged).toBe(1);
    expect(candidates.get({ PK: candidate.PK, SK: candidate.SK })).toBeUndefined();
  });

  it("conditional-delete guard: a row deleted between scan and delete (PK/SK gone) is never silently treated as success", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const realDelete = candidates.deleteCandidate.bind(candidates);
    candidates.deleteCandidate = (input) => {
      candidates.removeDirectly({ PK: candidate.PK, SK: candidate.SK });
      return realDelete(input);
    };

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.skippedConcurrentlyModified).toBe(1);
    expect(result.purged).toBe(0);
  });

  it("is idempotent: running twice against the same state purges once and no-ops (never throws) the second time", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    const candidate = makeWebhookInbox();
    candidates.seed(candidate);
    lifecycle.setStatus(candidate.tenantId, "ACTIVE");

    const first = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(first.purged).toBe(1);

    const second = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });
    expect(second).toEqual({ scanned: 0, purged: 0, skippedTooRecent: 0, skippedActiveUploadSlot: 0, skippedTenantNotActive: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes a mix of WebhookInbox/UploadSlot candidates across tenants in one run and touches ONLY the eligible ones", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-active", "ACTIVE");
    lifecycle.setStatus("tenant-closing", "DELETING");

    const eligibleInbox = makeWebhookInbox({ tenantId: "tenant-active", PK: "TENANT#tenant-active#WEBHOOK#SES#acct-1", SK: "EVENT#sns-1" });
    const tooRecentInbox = makeWebhookInbox({
      tenantId: "tenant-active",
      PK: "TENANT#tenant-active#WEBHOOK#SES#acct-1",
      SK: "EVENT#sns-2",
      createdAt: "2026-08-28T00:00:00.000Z",
    });
    const activeSlot = makeUploadSlot({ tenantId: "tenant-active", PK: "TENANT#tenant-active#UPLOAD", SK: "SLOT#slot-reserved", status: "RESERVED" });
    const nonActiveTenantInbox = makeWebhookInbox({ tenantId: "tenant-closing", PK: "TENANT#tenant-closing#WEBHOOK#SES#acct-1", SK: "EVENT#sns-3" });
    candidates.seed(eligibleInbox);
    candidates.seed(tooRecentInbox);
    candidates.seed(activeSlot);
    candidates.seed(nonActiveTenantInbox);

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result).toEqual({ scanned: 4, purged: 1, skippedTooRecent: 1, skippedActiveUploadSlot: 1, skippedTenantNotActive: 1, skippedConcurrentlyModified: 0 });
    expect(candidates.get({ PK: eligibleInbox.PK, SK: eligibleInbox.SK })).toBeUndefined();
    expect(candidates.get({ PK: tooRecentInbox.PK, SK: tooRecentInbox.SK })).toBeDefined();
    expect(candidates.get({ PK: activeSlot.PK, SK: activeSlot.SK })).toBeDefined();
    expect(candidates.get({ PK: nonActiveTenantInbox.PK, SK: nonActiveTenantInbox.SK })).toBeDefined();
  });

  it("drains multiple scan pages within one run", async () => {
    const candidates = new FakeTransientPurgeCandidateSource();
    candidates.pageSize = 1;
    const lifecycle = new FakeTenantLifecycleStatusSource();
    lifecycle.setStatus("tenant-1", "ACTIVE");
    const a = makeWebhookInbox({ PK: "TENANT#tenant-1#WEBHOOK#SES#acct-1", SK: "EVENT#sns-1" });
    const b = makeUploadSlot({ PK: "TENANT#tenant-1#UPLOAD", SK: "SLOT#slot-1", status: "EXPIRED" });
    candidates.seed(a);
    candidates.seed(b);

    const result = await runTransientPurge({ candidates, lifecycle, tableName: TABLE, now: () => NOW });

    expect(result.scanned).toBe(2);
    expect(result.purged).toBe(2);
  });
});
