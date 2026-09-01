import { describe, expect, it } from "vitest";
import { ActivityService } from "../../../src/modules/activity/application/activity-service.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { AuditPartitionStore, AuditPartitionPageInput, AuditPartitionPage } from "../../../src/modules/activity/ports/audit-partition-store.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

function ctx(roles: string[] = ["ADMIN"]): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-a", cognitoSubject: "sub-a", sessionId: "s1" },
    tenant: { tenantId: "tenant-a", roles: roles as RequestContext["tenant"]["roles"] },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

interface Row {
  PK: string;
  SK: string;
  auditEventId: string;
  occurredAt: string;
  actor: { type: "USER"; userId: string };
  action: string;
  resourceType: string;
  changes: Record<string, unknown>;
}

/** In-memory double of AuditPartitionStore backed by one flat array per PK, sorted by SK
 * ascending — mirrors real DynamoDB Query ordering semantics (SK embeds occurredAt). */
class InMemoryAuditPartitionStore implements AuditPartitionStore {
  private readonly rowsByPk = new Map<string, Row[]>();

  seed(pk: string, rows: Row[]): void {
    this.rowsByPk.set(pk, [...rows].sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0)));
  }

  async queryPage<T extends EntityKey = Record<string, unknown> & EntityKey>(input: AuditPartitionPageInput): Promise<AuditPartitionPage<T>> {
    const all = this.rowsByPk.get(input.pk) ?? [];
    const ordered = input.ascending ? all : [...all].reverse();
    let startIndex = 0;
    if (input.exclusiveStartKey) {
      const idx = ordered.findIndex((r) => r.PK === input.exclusiveStartKey!.PK && r.SK === input.exclusiveStartKey!.SK);
      startIndex = idx === -1 ? 0 : idx + 1;
    }
    const slice = ordered.slice(startIndex, startIndex + input.limit);
    const lastEvaluatedKey = startIndex + input.limit < ordered.length ? { PK: slice[slice.length - 1]!.PK, SK: slice[slice.length - 1]!.SK } : undefined;
    return { items: slice as unknown as T[], lastEvaluatedKey };
  }
}

function row(partitionPk: string, occurredAt: string, id: string, resourceType = "X"): Row {
  return {
    PK: partitionPk,
    SK: `EVT#${occurredAt}#${id}`,
    auditEventId: id,
    occurredAt,
    actor: { type: "USER", userId: "user-a" },
    action: "CREATE",
    resourceType,
    changes: {},
  };
}

describe("ActivityService.listActivity", () => {
  it("denies MEMBER/VIEWER (activity:read RBAC)", async () => {
    const service = new ActivityService({ store: new InMemoryAuditPartitionStore() });
    await expect(service.listActivity(ctx(["MEMBER"]), {})).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.listActivity(ctx(["VIEWER"]), {})).rejects.toThrow(AuthorizationDeniedError);
  });

  it("allows ADMIN/OWNER", async () => {
    const service = new ActivityService({ store: new InMemoryAuditPartitionStore() });
    await expect(service.listActivity(ctx(["ADMIN"]), {})).resolves.toBeDefined();
    await expect(service.listActivity(ctx(["OWNER"]), {})).resolves.toBeDefined();
  });

  it("rejects a malformed month", async () => {
    const service = new ActivityService({ store: new InMemoryAuditPartitionStore() });
    await expect(service.listActivity(ctx(), { month: "2026-09" })).rejects.toThrow();
  });

  it(
    "paginates every event across 4 partitions exactly once with no loss, across a cutoff mid-partition-batch " +
      "(the highest-risk scenario named in the design doc)",
    async () => {
      const store = new InMemoryAuditPartitionStore();
      const month = "202609";
      // 5 expiration events, 2 organization events, spread so a naive "raw LastEvaluatedKey"
      // cursor would skip events at the merge cutoff.
      store.seed(`TENANT#tenant-a#AUDIT#${month}`, [
        row(`TENANT#tenant-a#AUDIT#${month}`, "2026-09-01T10:00:00.000Z", "e1"),
        row(`TENANT#tenant-a#AUDIT#${month}`, "2026-09-01T09:30:00.000Z", "e2"),
        row(`TENANT#tenant-a#AUDIT#${month}`, "2026-09-01T09:00:00.000Z", "e3"),
        row(`TENANT#tenant-a#AUDIT#${month}`, "2026-09-01T08:30:00.000Z", "e4"),
        row(`TENANT#tenant-a#AUDIT#${month}`, "2026-09-01T08:00:00.000Z", "e5"),
      ]);
      store.seed(`TENANT#tenant-a#MEMBERSHIPAUDIT#${month}`, [
        row(`TENANT#tenant-a#MEMBERSHIPAUDIT#${month}`, "2026-09-01T09:45:00.000Z", "o1"),
        row(`TENANT#tenant-a#MEMBERSHIPAUDIT#${month}`, "2026-09-01T08:15:00.000Z", "o2"),
      ]);
      store.seed(`TENANT#tenant-a#SUBJECTAUDIT#${month}`, [row(`TENANT#tenant-a#SUBJECTAUDIT#${month}`, "2026-09-01T07:00:00.000Z", "s1")]);
      store.seed(`TENANT#tenant-a#TENANTAUDIT#${month}`, [row(`TENANT#tenant-a#TENANTAUDIT#${month}`, "2026-09-01T11:00:00.000Z", "t1")]);

      const service = new ActivityService({ store });

      const allIds: string[] = [];
      let cursor: string | undefined;
      let guard = 0;
      do {
        const page = await service.listActivity(ctx(), { month, limit: 3, cursor });
        allIds.push(...page.entries.map((e) => e.auditEventId));
        cursor = page.cursor;
        guard += 1;
        if (guard > 20) throw new Error("pagination did not terminate");
      } while (cursor);

      // Every event exactly once, newest-first overall order, no loss, no duplication.
      expect(allIds).toEqual(["t1", "e1", "o1", "e2", "e3", "e4", "o2", "e5", "s1"]);
      expect(new Set(allIds).size).toBe(allIds.length);
    },
  );

  it("filters by resourceType after merge", async () => {
    const store = new InMemoryAuditPartitionStore();
    const month = "202609";
    store.seed(`TENANT#tenant-a#AUDIT#${month}`, [row(`TENANT#tenant-a#AUDIT#${month}`, "2026-09-01T10:00:00.000Z", "e1", "ExpirationItem")]);
    store.seed(`TENANT#tenant-a#TENANTAUDIT#${month}`, [row(`TENANT#tenant-a#TENANTAUDIT#${month}`, "2026-09-01T09:00:00.000Z", "t1", "ExpirationExport")]);

    const service = new ActivityService({ store });
    const page = await service.listActivity(ctx(), { month, resourceType: "ExpirationExport" });

    expect(page.entries.map((e) => e.auditEventId)).toEqual(["t1"]);
  });
});
