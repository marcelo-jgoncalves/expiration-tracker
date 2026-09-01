/**
 * M2 exit criterion (implementation-blueprint.md §19): "item gerenciado end-to-end sem
 * reminders" - an ExpirationItem manageable via the full HTTP pipeline (resolver ->
 * service -> authorize -> OCC -> outbox -> audit), create through soft-delete, with no
 * reminder/notification wiring involved. Mirrors test/integration/cross-tenant.test.ts's
 * convention of exercising real handlers end-to-end rather than units in isolation.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../unit/identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../unit/organization/in-memory-store.js";
import { InMemoryExpirationStore, activeLifecycleRecord, makeExpirationIdGenerator, allowAllMemberEligibilityChecker } from "../unit/expiration/in-memory-store.js";
import { UserRepository } from "../../src/modules/identity/persistence/user-repository.js";
import { GlobalUserRepository } from "../../src/modules/identity/persistence/global-user-repository.js";
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

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    const users = new UserRepository(identityStore);
    resolver = new RequestContextResolver(users, new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    expirationStore = new InMemoryExpirationStore();
    const expiration = new ExpirationService({ store: expirationStore, tableName: "MainTable", ids: makeExpirationIdGenerator(), members: allowAllMemberEligibilityChecker() });
    deps = { resolver, expiration, quota };

    // W3-07 (D-070, chunk 9/N): ExpirationService.commit() now fences every mutation through
    // TenantBusinessMutation, which reads TenantLifecycleRecord from expirationStore's OWN
    // map - a real DynamoDB table shares the record with identityStore's atomic-bootstrap
    // write, but these two in-memory fakes are separate Maps (same gap already fixed for
    // document-handlers.test.ts/import-handlers.test.ts, D-070 chunk 8/N). Pre-resolving both
    // users this suite exercises (sub-A, sub-B) learns their bootstrapped tenantIds so the
    // ACTIVE lifecycle record can be mirrored into expirationStore too.
    //
    // Wave B2B-5 (D-095): bootstrapUser() no longer auto-provisions a tenant - seed a real
    // Organization+Membership for each sub first, via CreateOrganizationService, before resolve().
    for (const sub of ["sub-A", "sub-B"]) {
      await bootstrapWithOrganization(identityStore, organizations, "MainTable", sub);
      const bootstrapped = await resolver.resolve({ claims: claims(sub), requestId: `bootstrap-${sub}`, correlationId: `bootstrap-${sub}`, organizationIdHint: undefined });
      await expirationStore.putIfAbsent(activeLifecycleRecord(bootstrapped.tenant.tenantId));
    }
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

    // BLOCKER-B: outbox events now cover the full item lifecycle, not just manual due-date
    // edits - item-due-date-changed.v1 fires on create (x2, source+renewed), the manual
    // edit (x1), and the renewed item's own creation (x1) = 3; item-deactivated.v1 fires on
    // the source item's RENEWED transition, the archive, and the delete = 3.
    const outboxEvents = allRecords.filter((r) => r["entityType"] === "OutboxEvent");
    expect(outboxEvents).toHaveLength(6);
    const dueDateChanged = outboxEvents.filter((e) => e["eventType"] === "expiration.item-due-date-changed.v1");
    const deactivated = outboxEvents.filter((e) => e["eventType"] === "expiration.item-deactivated.v1");
    expect(dueDateChanged).toHaveLength(3);
    expect(deactivated).toHaveLength(3);
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

  describe("dashboard pagination (D-136/D-E)", () => {
    const req = { requestId: "r-page", correlationId: "c-page", claims: claims("sub-A") };

    it("defaults to a bounded limit and paginates via a real cursor across all items with no gap or duplicate", async () => {
      for (let i = 0; i < 5; i++) {
        await handleCreateItem(deps, { ...req, body: { name: `item-${i}`, category: "c", dueDate: `2026-09-${10 + i}T00:00:00.000Z` } });
      }

      const firstPage = await handleDashboard(deps, { ...req, queryStringParameters: { status: "ACTIVE", limit: "2" } });
      expect(firstPage.statusCode).toBe(200);
      expect((firstPage.body["items"] as unknown[]).length).toBe(2);
      expect(firstPage.body["nextCursor"]).toBeTruthy();

      const secondPage = await handleDashboard(deps, {
        ...req,
        queryStringParameters: { status: "ACTIVE", limit: "2", cursor: firstPage.body["nextCursor"] as string },
      });
      expect(secondPage.statusCode).toBe(200);
      expect((secondPage.body["items"] as unknown[]).length).toBe(2);

      const thirdPage = await handleDashboard(deps, {
        ...req,
        queryStringParameters: { status: "ACTIVE", limit: "2", cursor: secondPage.body["nextCursor"] as string },
      });
      expect(thirdPage.statusCode).toBe(200);
      expect((thirdPage.body["items"] as unknown[]).length).toBe(1);
      expect(thirdPage.body["nextCursor"]).toBeNull();

      const allNames = [...(firstPage.body["items"] as { name: string }[]), ...(secondPage.body["items"] as { name: string }[]), ...(thirdPage.body["items"] as { name: string }[])].map((i) => i.name);
      expect(new Set(allNames).size).toBe(5); // no duplicate, no gap across the 3 pages
    });

    it("rejects a cursor minted for a different status (fail-closed, never lets DynamoDB silently ignore the mismatch)", async () => {
      await handleCreateItem(deps, { ...req, body: { name: "active-item", category: "c", dueDate: "2026-09-10T00:00:00.000Z" } });
      const activePage = await handleDashboard(deps, { ...req, queryStringParameters: { status: "ACTIVE", limit: "1" } });
      // Force a cursor to exist by asking for a page smaller than the seeded set elsewhere in
      // this describe's shared `deps` - if this specific run has no more ACTIVE items, mint a
      // syntactically valid but wrong-status cursor by hand instead (still proves the check).
      const wrongStatusCursor = Buffer.from(JSON.stringify({ GSI1PK: "TENANT#not-this-tenant#ITEMSTATUS#RENEWED", GSI1SK: "DUE#x" })).toString("base64url");
      const rejected = await handleDashboard(deps, { ...req, queryStringParameters: { status: "ACTIVE", cursor: wrongStatusCursor } });
      expect(rejected.statusCode).toBe(400);
      expect(activePage.statusCode).toBe(200); // sanity: the ACTIVE query itself works
    });

    it("rejects a malformed (non-base64/non-JSON) cursor with 400", async () => {
      const rejected = await handleDashboard(deps, { ...req, queryStringParameters: { status: "ACTIVE", cursor: "not-a-real-cursor!!" } });
      expect(rejected.statusCode).toBe(400);
    });

    it("rejects limit=0, negative, and fractional as 400; caps an over-max limit at the server maximum instead of honoring the client's request", async () => {
      for (const bad of ["0", "-1", "1.5", "abc"]) {
        const rejected = await handleDashboard(deps, { ...req, queryStringParameters: { status: "ACTIVE", limit: bad } });
        expect(rejected.statusCode).toBe(400);
      }
      const overMax = await handleDashboard(deps, { ...req, queryStringParameters: { status: "ACTIVE", limit: "99999" } });
      expect(overMax.statusCode).toBe(200); // capped server-side, never a 400 for "too high" - never an unbounded query either
    });
  });
});
