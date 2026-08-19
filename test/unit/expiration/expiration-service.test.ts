import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryExpirationStore, makeExpirationIdGenerator } from "./in-memory-store.js";
import { ExpirationService } from "../../../src/modules/expiration/application/expiration-service.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: "tenant-1", roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

describe("ExpirationService", () => {
  let store: InMemoryExpirationStore;
  let service: ExpirationService;

  beforeEach(() => {
    store = new InMemoryExpirationStore();
    service = new ExpirationService({ store, tableName: "MainTable", ids: makeExpirationIdGenerator(), now: () => "2026-08-19T12:00:00.000Z" });
  });

  it("createItem writes the item (version 1, ACTIVE, GSI1 keyed by status+dueDate) and an audit record atomically", async () => {
    const item = await service.createItem(ctx(), { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" });

    expect(item.version).toBe(1);
    expect(item.status).toBe("ACTIVE");
    expect(item.categoryNormalized).toBe("licencas");
    expect(item.GSI1PK).toBe("TENANT#tenant-1#ITEMSTATUS#ACTIVE");
    expect(item.GSI1SK).toBe("DUE#2026-09-10T00:00:00.000Z#ITEM#item-1");

    const audits = store.allItems().filter((i) => i["entityType"] === "AuditEvent");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.["action"]).toBe("CREATE");
  });

  it("createItem denies a VIEWER role", async () => {
    await expect(
      service.createItem(ctx({ tenant: { tenantId: "tenant-1", roles: ["VIEWER"] } }), {
        name: "x",
        category: "y",
        dueDate: "2026-09-10T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("getItem 404s on a soft-deleted item", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.deleteItem(ctx(), item.itemId, item.version);
    await expect(service.getItem(ctx(), item.itemId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateItem enforces OCC: a stale expectedVersion is rejected with ConflictError, a fresh one succeeds", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });

    await expect(service.updateItem(ctx(), item.itemId, { name: "b" }, 999)).rejects.toBeInstanceOf(ConflictError);

    const updated = await service.updateItem(ctx(), item.itemId, { name: "b" }, item.version);
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("b");
  });

  it("changing dueDate via updateItem emits ItemDueDateChanged through the outbox in the same transaction as the item write", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.updateItem(ctx(), item.itemId, { dueDate: "2026-10-01T00:00:00.000Z" }, item.version);

    const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(1);
    expect(outboxRecords[0]?.["eventType"]).toBe("expiration.item-due-date-changed.v1");
    const payload = outboxRecords[0]?.["payload"] as Record<string, unknown>;
    expect(payload["previousDueDate"]).toBe("2026-09-10T00:00:00.000Z");
    expect(payload["newDueDate"]).toBe("2026-10-01T00:00:00.000Z");
    expect(payload["itemVersion"]).toBe(2);
  });

  it("updateItem without a dueDate change writes no outbox record", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.updateItem(ctx(), item.itemId, { name: "renamed" }, item.version);

    const outboxRecords = store.allItems().filter((i) => i["entityType"] === "OutboxEvent");
    expect(outboxRecords).toHaveLength(0);
  });

  it("every mutation appends exactly one append-only AuditEvent - no update/delete API is exposed for it", async () => {
    const item = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    await service.updateItem(ctx(), item.itemId, { name: "b" }, item.version);
    await service.archiveItem(ctx(), item.itemId, item.version + 1);

    const audits = store.allItems().filter((i) => i["entityType"] === "AuditEvent");
    expect(audits.map((a) => a["action"])).toEqual(["CREATE", "UPDATE", "ARCHIVE"]);
    for (const audit of audits) {
      expect(audit["PK"]).toMatch(/^TENANT#tenant-1#AUDIT#\d{6}$/);
    }
  });

  it("renewItem creates a new ACTIVE item (lineage successor), marks the source RENEWED, and never mutates the source dueDate in place", async () => {
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    const renewed = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version);

    expect(renewed.itemId).not.toBe(source.itemId);
    expect(renewed.status).toBe("ACTIVE");
    expect(renewed.renewedFromId).toBe(source.itemId);
    expect(renewed.dueDate).toBe("2027-09-10T00:00:00.000Z");

    const sourceAfter = await store.get<{ PK: string; SK: string; status: string; dueDate: string }>({
      PK: `TENANT#tenant-1#ITEM#${source.itemId}`,
      SK: "META",
    });
    expect(sourceAfter?.status).toBe("RENEWED");
    expect(sourceAfter?.dueDate).toBe("2026-09-10T00:00:00.000Z"); // unchanged - renewal never mutates the source's dueDate
  });

  it("renewItem is idempotent: retrying with the same key returns the same new item instead of creating a second one", async () => {
    const source = await service.createItem(ctx(), { name: "a", category: "b", dueDate: "2026-09-10T00:00:00.000Z" });
    const first = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "fixed-key");
    const second = await service.renewItem(ctx(), source.itemId, { newDueDate: "2027-09-10T00:00:00.000Z" }, source.version, "fixed-key");

    expect(second.itemId).toBe(first.itemId);
    const allItems = store.allItems().filter((i) => i["entityType"] === "ExpirationItem");
    expect(allItems).toHaveLength(2); // source + one renewed successor, not two
  });

  it("listDashboard queries GSI1 by tenant+status and returns items ordered by dueDate", async () => {
    await service.createItem(ctx(), { name: "later", category: "b", dueDate: "2026-12-01T00:00:00.000Z" });
    await service.createItem(ctx(), { name: "sooner", category: "b", dueDate: "2026-09-01T00:00:00.000Z" });

    const items = await service.listDashboard(ctx(), { status: "ACTIVE" });
    expect(items.map((i) => i.name)).toEqual(["sooner", "later"]);
  });

  it("listDashboard for one tenant never returns another tenant's items", async () => {
    await service.createItem(ctx({ tenant: { tenantId: "tenant-1", roles: ["OWNER"] } }), {
      name: "tenant-1-item",
      category: "b",
      dueDate: "2026-09-01T00:00:00.000Z",
    });
    await service.createItem(ctx({ tenant: { tenantId: "tenant-2", roles: ["OWNER"] } }), {
      name: "tenant-2-item",
      category: "b",
      dueDate: "2026-09-01T00:00:00.000Z",
    });

    const items = await service.listDashboard(ctx({ tenant: { tenantId: "tenant-1", roles: ["OWNER"] } }), { status: "ACTIVE" });
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("tenant-1-item");
  });
});
