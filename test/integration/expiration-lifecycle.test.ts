/**
 * M2 exit criterion (implementation-blueprint.md §19): "item gerenciado end-to-end sem
 * reminders" - an ExpirationItem manageable via the full HTTP pipeline (resolver ->
 * service -> authorize -> OCC -> outbox -> audit), create through soft-delete, with no
 * reminder/notification wiring involved. Mirrors test/integration/cross-tenant.test.ts's
 * convention of exercising real handlers end-to-end rather than units in isolation.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator } from "../unit/identity/in-memory-store.js";
import { InMemoryExpirationStore, makeExpirationIdGenerator } from "../unit/expiration/in-memory-store.js";
import { IdentityMappingRepository } from "../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../src/modules/identity/persistence/user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { ExpirationService } from "../../src/modules/expiration/application/expiration-service.js";
import {
  handleArchiveItem,
  handleCreateItem,
  handleDashboard,
  handleDeleteItem,
  handleGetItem,
  handleRenewItem,
  handleUpdateItem,
} from "../../src/modules/expiration/http/item-handlers.js";

function claims(sub: string): ValidatedClaims {
  return {
    sub,
    tokenId: `jti-${sub}`,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("ExpirationItem end-to-end lifecycle (M2 exit criterion, no reminders)", () => {
  let resolver: RequestContextResolver;
  let expirationStore: InMemoryExpirationStore;
  let deps: { resolver: RequestContextResolver; expiration: ExpirationService; quota: TenantQuotaService };

  beforeEach(() => {
    const identityStore = new InMemoryIdentityStore();
    const mappings = new IdentityMappingRepository(identityStore);
    const users = new UserRepository(identityStore);
    resolver = new RequestContextResolver(mappings, users, makeIdGenerator());
    const quota = new TenantQuotaService(identityStore);

    expirationStore = new InMemoryExpirationStore();
    const expiration = new ExpirationService({ store: expirationStore, tableName: "MainTable", ids: makeExpirationIdGenerator() });
    deps = { resolver, expiration, quota };
  });

  it("create -> read -> update (due-date change produces the outbox event) -> renew -> soft-delete, all via HTTP handlers, with an audit trail and no ReminderOccurrence/NotificationIntent writes anywhere", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };

    const created = await handleCreateItem(deps, {
      ...req,
      body: { name: "Alvará de funcionamento", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" },
    });
    expect(created.statusCode).toBe(201);
    const itemId = (created.body["item"] as { itemId: string }).itemId;

    const read = await handleGetItem(deps, { ...req, pathParameters: { itemId } });
    expect(read.statusCode).toBe(200);
    expect((read.body["item"] as { status: string }).status).toBe("ACTIVE");

    const updated = await handleUpdateItem(deps, {
      ...req,
      pathParameters: { itemId },
      headers: { "if-match": "1" },
      body: { dueDate: "2026-10-01T00:00:00.000Z" },
    });
    expect(updated.statusCode).toBe(200);
    const updatedItem = updated.body["item"] as { version: number; dueDate: string };
    expect(updatedItem.version).toBe(2);
    expect(updatedItem.dueDate).toBe("2026-10-01T00:00:00.000Z");

    // Stale If-Match is rejected with 409, proving OCC is enforced at the HTTP boundary too.
    const staleUpdate = await handleUpdateItem(deps, {
      ...req,
      pathParameters: { itemId },
      headers: { "if-match": "1" },
      body: { name: "should fail" },
    });
    expect(staleUpdate.statusCode).toBe(409);

    const renewed = await handleRenewItem(deps, {
      ...req,
      pathParameters: { itemId },
      headers: { "if-match": "2" },
      body: { newDueDate: "2027-10-01T00:00:00.000Z" },
    });
    expect(renewed.statusCode).toBe(201);
    const renewedItem = renewed.body["item"] as { itemId: string; renewedFromId: string; status: string };
    expect(renewedItem.renewedFromId).toBe(itemId);
    expect(renewedItem.status).toBe("ACTIVE");

    const sourceAfterRenewal = await handleGetItem(deps, { ...req, pathParameters: { itemId } });
    expect((sourceAfterRenewal.body["item"] as { status: string }).status).toBe("RENEWED");

    const archived = await handleArchiveItem(deps, { ...req, pathParameters: { itemId: renewedItem.itemId }, headers: { "if-match": "1" } });
    expect(archived.statusCode).toBe(204);

    const deleted = await handleDeleteItem(deps, { ...req, pathParameters: { itemId: renewedItem.itemId }, headers: { "if-match": "2" } });
    expect(deleted.statusCode).toBe(204);

    const readAfterDelete = await handleGetItem(deps, { ...req, pathParameters: { itemId: renewedItem.itemId } });
    expect(readAfterDelete.statusCode).toBe(404);

    // Dashboard via GSI1.
    const dashboard = await handleDashboard(deps, { ...req, queryStringParameters: { status: "RENEWED" } });
    expect(dashboard.statusCode).toBe(200);
    expect((dashboard.body["items"] as unknown[]).length).toBe(1);

    // Audit trail: append-only, one record per mutation (create, due-date update, renew's
    // two-sided audit, archive, delete). No reminder/notification entity is ever written.
    const allRecords = expirationStore.allItems();
    const auditRecords = allRecords.filter((r) => r["entityType"] === "AuditEvent");
    expect(auditRecords.length).toBeGreaterThanOrEqual(5);
    const reminderOrNotificationRecords = allRecords.filter(
      (r) => r["entityType"] === "ReminderOccurrence" || r["entityType"] === "NotificationIntent",
    );
    expect(reminderOrNotificationRecords).toHaveLength(0);

    // ItemDueDateChanged fired exactly twice: once for the manual due-date edit, once for the renewal.
    const outboxEvents = allRecords.filter((r) => r["entityType"] === "OutboxEvent");
    expect(outboxEvents).toHaveLength(2);
    for (const evt of outboxEvents) {
      expect(evt["eventType"]).toBe("expiration.item-due-date-changed.v1");
    }
  });

  it("cross-tenant: tenant A cannot read, update or delete tenant B's item, even by guessing its itemId", async () => {
    const reqA = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
    const reqB = { requestId: "r2", correlationId: "c2", claims: claims("sub-B") };

    const createdB = await handleCreateItem(deps, {
      ...reqB,
      body: { name: "tenant B secret item", category: "x", dueDate: "2026-09-10T00:00:00.000Z" },
    });
    const itemIdB = (createdB.body["item"] as { itemId: string }).itemId;

    const readAsA = await handleGetItem(deps, { ...reqA, pathParameters: { itemId: itemIdB } });
    expect(readAsA.statusCode).toBe(404); // tenant A's context can't reach tenant B's PK, so it's a strong-consistency 404, not a leaked 403

    const updateAsA = await handleUpdateItem(deps, {
      ...reqA,
      pathParameters: { itemId: itemIdB },
      headers: { "if-match": "1" },
      body: { name: "hijacked" },
    });
    expect(updateAsA.statusCode).toBe(404);

    const deleteAsA = await handleDeleteItem(deps, { ...reqA, pathParameters: { itemId: itemIdB }, headers: { "if-match": "1" } });
    expect(deleteAsA.statusCode).toBe(404);
  });
});
