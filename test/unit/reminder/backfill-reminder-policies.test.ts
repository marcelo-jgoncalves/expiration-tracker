/**
 * BLOCKER-B backfill script coverage (reminder-delivery-pipeline.md §9, Codex Round H
 * APPROVED 9.2/10). Covers processPage's idempotency (safe to run twice) and the
 * encodeKey/decodeKey/parseArgs pure helpers - not the real Scan/CLI entrypoint, which
 * needs a live table and is exercised manually per the script's own --dry-run mode.
 */
import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "./in-memory-store.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { policyRefKey } from "../../../src/modules/reminder/domain/reminder-policy.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { ReminderOccurrence } from "../../../src/modules/reminder/domain/reminder-occurrence.js";
import { decodeKey, encodeKey, parseArgs, processPage } from "../../../scripts/backfill-reminder-policies.js";

const TENANT = "t1";
const TABLE = "MainTable";
const NOW = "2026-08-01T00:00:00.000Z";

describe("backfill-reminder-policies: parseArgs", () => {
  it("parses --table, --after, --page-size, --dry-run", () => {
    const args = parseArgs(["--table", "MainTable", "--after", "abc123", "--page-size", "50", "--dry-run"]);
    expect(args).toEqual({ table: "MainTable", after: "abc123", pageSize: 50, dryRun: true });
  });

  it("defaults pageSize to 25 and dryRun to false", () => {
    const args = parseArgs(["--table", "MainTable"]);
    expect(args.pageSize).toBe(25);
    expect(args.dryRun).toBe(false);
    expect(args.after).toBeUndefined();
  });

  it("throws if --table is missing", () => {
    expect(() => parseArgs([])).toThrow("--table");
  });
});

describe("backfill-reminder-policies: encodeKey/decodeKey round-trip", () => {
  it("round-trips a LastEvaluatedKey-shaped object through base64", () => {
    const key = { PK: "TENANT#t1#POLICY#p1", SK: "META" };
    const token = encodeKey(key)!;
    expect(decodeKey(token)).toEqual(key);
  });

  it("returns undefined for an undefined key/token", () => {
    expect(encodeKey(undefined)).toBeUndefined();
    expect(decodeKey(undefined)).toBeUndefined();
  });
});

describe("backfill-reminder-policies: processPage", () => {
  it("creates the pointer and materializes for a pre-existing ITEM-scoped enabled policy", async () => {
    const store = new InMemoryReminderStore();
    const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
    await store.putIfAbsent({ ...itemKey(TENANT, "item1"), entityType: "ExpirationItem", itemId: "item1", tenantId: TENANT, status: "ACTIVE", dueDate: "2026-09-10T00:00:00.000Z", version: 1 });
    // Simulates a policy saved BEFORE BLOCKER-B deployed: no pointer exists for it.
    const policy = {
      PK: "TENANT#t1#POLICY#p1",
      SK: "META" as const,
      entityType: "ReminderPolicy" as const,
      policyId: "p1",
      tenantId: TENANT,
      scope: "ITEM" as const,
      itemId: "item1",
      name: "r",
      triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL" as const],
      enabled: true,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await store.putIfAbsent(policy);

    const result = await processPage(store, materializer, [policy], false);

    expect(result.itemScoped).toBe(1);
    expect(result.pointersWritten).toBe(1);
    expect(result.occurrencesCreated).toBe(1);
    expect(await store.get(policyRefKey(TENANT, "item1", "p1"))).toBeDefined();
  });

  it("is idempotent: running the same page twice does not duplicate the pointer or the occurrence", async () => {
    const store = new InMemoryReminderStore();
    const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
    await store.putIfAbsent({ ...itemKey(TENANT, "item1"), entityType: "ExpirationItem", itemId: "item1", tenantId: TENANT, status: "ACTIVE", dueDate: "2026-09-10T00:00:00.000Z", version: 1 });
    const policy = {
      PK: "TENANT#t1#POLICY#p1",
      SK: "META" as const,
      entityType: "ReminderPolicy" as const,
      policyId: "p1",
      tenantId: TENANT,
      scope: "ITEM" as const,
      itemId: "item1",
      name: "r",
      triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL" as const],
      enabled: true,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await store.putIfAbsent(policy);

    const first = await processPage(store, materializer, [policy], false);
    const second = await processPage(store, materializer, [policy], false);

    expect(first.pointersWritten).toBe(1);
    expect(first.occurrencesCreated).toBe(1);
    expect(second.pointersWritten).toBe(0); // already exists - putIfAbsent no-ops
    expect(second.occurrencesCreated).toBe(0); // materialize() is idempotent

    const occs = (await store.queryByItem<ReminderOccurrence>(TENANT, "item1")) as ReminderOccurrence[];
    expect(occs).toHaveLength(1);
  });

  it("skips a policy whose item is missing or not ACTIVE, without writing a pointer", async () => {
    const store = new InMemoryReminderStore();
    const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
    // No item seeded at all.
    const policy = {
      PK: "TENANT#t1#POLICY#p1",
      SK: "META" as const,
      entityType: "ReminderPolicy" as const,
      policyId: "p1",
      tenantId: TENANT,
      scope: "ITEM" as const,
      itemId: "ghost-item",
      name: "r",
      triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL" as const],
      enabled: true,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = await processPage(store, materializer, [policy], false);

    expect(result.skippedMissingOrInactiveItem).toBe(1);
    expect(result.pointersWritten).toBe(0);
    expect(result.occurrencesCreated).toBe(0);
  });

  it("skips a disabled policy's materialization but still creates its pointer (discoverable for future re-enable)", async () => {
    const store = new InMemoryReminderStore();
    const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
    await store.putIfAbsent({ ...itemKey(TENANT, "item1"), entityType: "ExpirationItem", itemId: "item1", tenantId: TENANT, status: "ACTIVE", dueDate: "2026-09-10T00:00:00.000Z", version: 1 });
    const policy = {
      PK: "TENANT#t1#POLICY#p1",
      SK: "META" as const,
      entityType: "ReminderPolicy" as const,
      policyId: "p1",
      tenantId: TENANT,
      scope: "ITEM" as const,
      itemId: "item1",
      name: "r",
      triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL" as const],
      enabled: false,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = await processPage(store, materializer, [policy], false);

    expect(result.pointersWritten).toBe(1);
    expect(result.occurrencesCreated).toBe(0);
  });

  it("ignores TEMPLATE-scoped policies entirely (out of scope per the approved design)", async () => {
    const store = new InMemoryReminderStore();
    const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
    const policy = {
      PK: "TENANT#t1#POLICY#p1",
      SK: "META" as const,
      entityType: "ReminderPolicy" as const,
      policyId: "p1",
      tenantId: TENANT,
      scope: "TEMPLATE" as const,
      name: "r",
      triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL" as const],
      enabled: true,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = await processPage(store, materializer, [policy], false);

    expect(result.itemScoped).toBe(0);
    expect(result.pointersWritten).toBe(0);
  });

  it("dry-run mode reports what it found but writes nothing", async () => {
    const store = new InMemoryReminderStore();
    const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
    await store.putIfAbsent({ ...itemKey(TENANT, "item1"), entityType: "ExpirationItem", itemId: "item1", tenantId: TENANT, status: "ACTIVE", dueDate: "2026-09-10T00:00:00.000Z", version: 1 });
    const policy = {
      PK: "TENANT#t1#POLICY#p1",
      SK: "META" as const,
      entityType: "ReminderPolicy" as const,
      policyId: "p1",
      tenantId: TENANT,
      scope: "ITEM" as const,
      itemId: "item1",
      name: "r",
      triggers: [{ triggerId: "t1", offsetIso: "-P7D", localTime: "09:00" }],
      timeZone: "America/Sao_Paulo",
      channels: ["EMAIL" as const],
      enabled: true,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const result = await processPage(store, materializer, [policy], true);

    expect(result.itemScoped).toBe(1);
    expect(result.pointersWritten).toBe(0);
    expect(result.occurrencesCreated).toBe(0);
    expect(await store.get(policyRefKey(TENANT, "item1", "p1"))).toBeUndefined();
  });
});
