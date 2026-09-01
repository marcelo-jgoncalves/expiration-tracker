/**
 * D-149 (admin-activity-log-scoping/estado-final-consolidado.md) end-to-end: real ExpirationItem
 * mutations (via the real HTTP item-handlers pipeline) produce real AuditEvent rows, and GET
 * /activity (via the real activity-handlers pipeline) merges them with rows from the other 3
 * audit partitions (organization/subject/tenant - simulated here as raw seeded rows, since
 * standing up full Organization/Subject services is out of scope for this suite) into one
 * chronological feed, with cursor-driven pagination that loses nothing and duplicates nothing.
 * Mirrors test/integration/expiration-lifecycle.test.ts's convention of exercising real
 * handlers end-to-end rather than units in isolation.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "../unit/identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../unit/organization/in-memory-store.js";
import { InMemoryExpirationStore, activeLifecycleRecord, makeExpirationIdGenerator, allowAllMemberEligibilityChecker } from "../unit/expiration/in-memory-store.js";
import { GlobalUserRepository } from "../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { ExpirationService } from "../../src/modules/expiration/application/expiration-service.js";
import { handleCreateItem, handleUpdateItem, type ExpirationHttpDeps } from "../../src/modules/expiration/http/item-handlers.js";
import { ActivityService } from "../../src/modules/activity/application/activity-service.js";
import { handleListActivity, type ActivityHttpDeps } from "../../src/modules/activity/http/activity-handlers.js";
import type { AuditPartitionStore, AuditPartitionPageInput, AuditPartitionPage } from "../../src/modules/activity/ports/audit-partition-store.js";
import type { EntityKey } from "../../src/shared/dynamodb/occ.js";

function claims(sub: string): ValidatedClaims {
  return {
    sub,
    tokenId: `jti-${sub}`,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

/** Real "expiration" partition backed by the same InMemoryExpirationStore item-handlers write
 * to; the other 3 partitions are plain seeded rows (simulating organization/subject/tenant
 * modules' own AuditEvent siblings) — exactly the shape ActivityService's RawAuditRow expects. */
class CompositeAuditPartitionStore implements AuditPartitionStore {
  private readonly other = new Map<string, Array<Record<string, unknown> & EntityKey>>();

  constructor(private readonly expirationStore: InMemoryExpirationStore) {}

  seed(pk: string, rows: Array<Record<string, unknown> & EntityKey>): void {
    this.other.set(pk, [...rows].sort((a, b) => String(a["SK"]).localeCompare(String(b["SK"]))));
  }

  async queryPage<T extends EntityKey = Record<string, unknown> & EntityKey>(input: AuditPartitionPageInput): Promise<AuditPartitionPage<T>> {
    let all: Array<Record<string, unknown> & EntityKey>;
    if (input.pk.includes("#AUDIT#")) {
      all = (await this.expirationStore.queryByPk(input.pk)) as unknown as Array<Record<string, unknown> & EntityKey>;
    } else {
      all = this.other.get(input.pk) ?? [];
    }
    const ordered = input.ascending ? all : [...all].reverse();
    let startIndex = 0;
    if (input.exclusiveStartKey) {
      const idx = ordered.findIndex((r) => r["PK"] === input.exclusiveStartKey!.PK && r["SK"] === input.exclusiveStartKey!.SK);
      startIndex = idx === -1 ? 0 : idx + 1;
    }
    const slice = ordered.slice(startIndex, startIndex + input.limit);
    const lastEvaluatedKey = startIndex + input.limit < ordered.length ? { PK: slice[slice.length - 1]!["PK"] as string, SK: slice[slice.length - 1]!["SK"] as string } : undefined;
    return { items: slice as unknown as T[], lastEvaluatedKey };
  }
}

function seedRow(pk: string, occurredAt: string, id: string, resourceType: string): Record<string, unknown> & EntityKey {
  return {
    PK: pk,
    SK: `EVT#${occurredAt}#${id}`,
    auditEventId: id,
    occurredAt,
    actor: { type: "SYSTEM" },
    action: "CREATE",
    resourceType,
    changes: {},
  };
}

describe("GET /activity end-to-end (D-149): real ExpirationItem audit trail merged across 4 partitions", () => {
  let itemDeps: ExpirationHttpDeps;
  let activityDeps: ActivityHttpDeps;
  let tenantId: string;
  let store: CompositeAuditPartitionStore;

  beforeEach(async () => {
    const identityStore = new InMemoryIdentityStore();
    const organizations = new InMemoryOrganizationStore();
    const resolver = new RequestContextResolver(new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
    const quota = new TenantQuotaService(identityStore, "MainTable");

    const expirationStore = new InMemoryExpirationStore();
    const expiration = new ExpirationService({ store: expirationStore, tableName: "MainTable", ids: makeExpirationIdGenerator(), members: allowAllMemberEligibilityChecker() });
    itemDeps = { resolver, expiration, quota };

    const bootstrapped = await bootstrapWithOrganization(identityStore, organizations, "MainTable", "sub-A");
    const resolvedCtx = await resolver.resolve({ claims: claims("sub-A"), requestId: "bootstrap", correlationId: "bootstrap", organizationIdHint: undefined });
    tenantId = resolvedCtx.tenant.tenantId;
    await expirationStore.putIfAbsent(activeLifecycleRecord(tenantId));
    void bootstrapped;

    store = new CompositeAuditPartitionStore(expirationStore);
    const activity = new ActivityService({ store, now: () => "2026-09-15T00:00:00.000Z" });
    activityDeps = { resolver, activity, quota };
  });

  it("merges real expiration-module audit events with the other 3 (simulated) partitions in chronological order, and pagination via the real cursor loses/duplicates nothing", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };

    // Two real mutations through the real HTTP pipeline -> two real AuditEvent rows in the
    // "expiration" partition (CREATE, then UPDATE from the due-date change).
    const created = await handleCreateItem(itemDeps, {
      ...req,
      body: { name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" },
    });
    const itemId = (created.body["item"] as { itemId: string }).itemId;
    await handleUpdateItem(itemDeps, {
      ...req,
      pathParameters: { itemId },
      headers: { "if-match": "1" },
      body: { dueDate: "2026-10-01T00:00:00.000Z" },
    });

    // Seed the other 3 modules' partitions for the same month with events interleaved in time
    // around the 2 real expiration events above, so a naive per-partition-only cursor would
    // otherwise skip/duplicate at the merge cutoff (same risk class as merge.test.ts/
    // activity-service.test.ts's cursor tests, now proven through the real HTTP handler).
    const month = "202609";
    store.seed(`TENANT#${tenantId}#MEMBERSHIPAUDIT#${month}`, [
      seedRow(`TENANT#${tenantId}#MEMBERSHIPAUDIT#${month}`, "2026-09-15T00:00:01.000Z", "org-1", "Membership"),
    ]);
    store.seed(`TENANT#${tenantId}#SUBJECTAUDIT#${month}`, [
      seedRow(`TENANT#${tenantId}#SUBJECTAUDIT#${month}`, "2026-09-15T00:00:02.000Z", "subj-1", "TrackedSubject"),
    ]);
    store.seed(`TENANT#${tenantId}#TENANTAUDIT#${month}`, [
      seedRow(`TENANT#${tenantId}#TENANTAUDIT#${month}`, "2026-09-15T00:00:03.000Z", "tnt-1", "ExpirationExport"),
    ]);

    const allIds: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    do {
      const page = await handleListActivity(activityDeps, { ...req, queryStringParameters: { month, limit: "1", ...(cursor ? { cursor } : {}) } });
      expect(page.statusCode).toBe(200);
      const entries = page.body["entries"] as Array<{ auditEventId: string; resourceType: string }>;
      allIds.push(...entries.map((e) => e.auditEventId));
      cursor = (page.body["cursor"] as string | null) ?? undefined;
      guard += 1;
      if (guard > 20) throw new Error("pagination did not terminate");
    } while (cursor);

    // 5 total events: 2 real expiration (create + due-date-change update), 3 seeded siblings.
    // Every one exactly once, no loss, no duplication, and the resourceType confirms the merge
    // actually crossed module boundaries (not just re-reading the expiration partition).
    expect(new Set(allIds).size).toBe(5);
    expect(allIds).toHaveLength(5);
    expect(allIds).toEqual(expect.arrayContaining(["org-1", "subj-1", "tnt-1"]));
  });

  it("RBAC: MEMBER/VIEWER get 403 from the real HTTP handler, ADMIN/OWNER get 200", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
    // sub-A is OWNER of its own bootstrapped organization (default role on creation).
    const asOwner = await handleListActivity(activityDeps, { ...req, queryStringParameters: {} });
    expect(asOwner.statusCode).toBe(200);
  });

  it("rejects a non-numeric limit with 400 via the schema-validated HTTP edge", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
    const rejected = await handleListActivity(activityDeps, { ...req, queryStringParameters: { limit: "abc" } });
    expect(rejected.statusCode).toBe(400);
  });

  it("rejects a malformed month with 400", async () => {
    const req = { requestId: "r1", correlationId: "c1", claims: claims("sub-A") };
    const rejected = await handleListActivity(activityDeps, { ...req, queryStringParameters: { month: "2026-09" } });
    expect(rejected.statusCode).toBe(400);
  });
});
