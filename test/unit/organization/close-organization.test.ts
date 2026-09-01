import { describe, expect, it } from "vitest";
import { CloseOrganizationService, type TenantLifecycleReader } from "../../../src/modules/organization/application/close-organization.js";
import { tenantLifecycleKey, type TenantLifecycleRecord, type TenantLifecycleStatus } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { transitionTenantLifecycle } from "../../../src/shared/tenant-lifecycle/system-mutation.js";
import type { TenantPurgeExecutionStarter } from "../../../src/shared/tenant-lifecycle/tenant-purge-execution-starter.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { OrganizationClosureUnavailableError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";

const TABLE = "MainTable";

function ctx(roles: string[]): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "s1" },
    tenant: { tenantId: "org-1", roles },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

async function seed(store: InMemoryIdentityStore, status: TenantLifecycleStatus, version = 1, extra: Partial<TenantLifecycleRecord> = {}): Promise<void> {
  await store.putIfAbsent({
    ...tenantLifecycleKey("org-1"),
    entityType: "TenantLifecycleRecord",
    tenantId: "org-1",
    status,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version,
    ...extra,
  });
}

function readerFor(store: InMemoryIdentityStore): TenantLifecycleReader {
  return { read: async (tenantId) => store.get<TenantLifecycleRecord>(tenantLifecycleKey(tenantId)) };
}

function recordingStarter(): TenantPurgeExecutionStarter & { started: Array<{ name: string; tenantId: string }> } {
  const started: Array<{ name: string; tenantId: string }> = [];
  return {
    started,
    startExecution: async (input) => {
      started.push({ name: input.name, tenantId: input.input.tenantId });
      return { executionArn: `arn:aws:states:us-east-1:1:execution:x-tenant-purge:${input.name}` };
    },
  };
}

function build(store: InMemoryIdentityStore, starter: TenantPurgeExecutionStarter, newClosureAttemptId: () => string = () => "attempt-1"): CloseOrganizationService {
  return new CloseOrganizationService(store, readerFor(store), starter, TABLE, () => "2026-08-31T12:00:00.000Z", newClosureAttemptId);
}

describe("CloseOrganizationService (D-121 Rodada 2 Fix 1 + Rodada 3 Fix 8, extended D-127)", () => {
  it("moves ACTIVE -> HELD_FOR_RECOVERY, stamps recoveryDeadline/closureAttemptId, and starts the purge execution named by tenantId-closureAttemptId", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "ACTIVE");
    const starter = recordingStarter();

    const result = await build(store, starter).close(ctx(["OWNER"]));

    expect(result).toEqual({ tenantId: "org-1", status: "HELD_FOR_RECOVERY", transitioned: true });
    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("org-1"));
    expect(record?.status).toBe("HELD_FOR_RECOVERY");
    expect(record?.closureAttemptId).toBe("attempt-1");
    // 30 days after the injected `now`.
    expect(record?.recoveryDeadline).toBe("2026-09-30T12:00:00.000Z");
    expect(record?.executionArn).toBe("arn:aws:states:us-east-1:1:execution:x-tenant-purge:org-1-attempt-1");
    // D-127: name is `${tenantId}-${closureAttemptId}`, NOT the bare tenantId - the whole point of
    // the new naming scheme is that a second close() after a real cancellation gets a fresh name.
    expect(starter.started).toEqual([{ name: "org-1-attempt-1", tenantId: "org-1" }]);
  });

  // G-V3 target: Rodada 3 Fix 8's corrected ordering - the terminal-state check runs BEFORE the
  // unconditional StartExecution, not after. Mutation that must fail: moving the
  // CLOSURE_UNAVAILABLE_STATUSES check below the startExecution call (Rodada 2's original,
  // uncorrected ordering) makes these assertions fail because an execution IS started for a
  // tenant that is already DELETED/BLOCKED.
  it.each(["VERIFIED", "DELETED", "BLOCKED", "HELD"] as const)("refuses a %s tenant and starts NO execution", async (status) => {
    const store = new InMemoryIdentityStore();
    await seed(store, status);
    const starter = recordingStarter();

    await expect(build(store, starter).close(ctx(["OWNER"]))).rejects.toBeInstanceOf(OrganizationClosureUnavailableError);
    expect(starter.started).toEqual([]);
  });

  // The other half of the same corrected ordering: the genuinely in-flight states DO fall through
  // to the unconditional retry, with no write. Mutation that must fail: gating startExecution on
  // `transitioned` orphans a tenant whose first StartExecution failed transiently.
  it.each(["HELD_FOR_RECOVERY", "DELETING", "QUIESCING", "PURGING"] as const)("re-launches the execution for an in-flight %s tenant without writing anything", async (status) => {
    const store = new InMemoryIdentityStore();
    await seed(store, status, 5, { closureAttemptId: "attempt-1" });
    const starter = recordingStarter();

    const result = await build(store, starter).close(ctx(["OWNER"]));

    expect(result).toEqual({ tenantId: "org-1", status, transitioned: false });
    expect(starter.started).toEqual([{ name: "org-1-attempt-1", tenantId: "org-1" }]);
    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey("org-1"));
    expect(record?.version).toBe(5); // untouched - no write happened
  });

  it("denies ADMIN (OWNER-only tier - the most destructive tenant-wide action there is)", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "ACTIVE");
    const starter = recordingStarter();

    await expect(build(store, starter).close(ctx(["ADMIN"]))).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(starter.started).toEqual([]);
  });

  it.each([["MEMBER"], ["VIEWER"]])("denies %s", async (role) => {
    const store = new InMemoryIdentityStore();
    await seed(store, "ACTIVE");
    await expect(build(store, recordingStarter()).close(ctx([role!]))).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("joins a concurrent close() that won the OCC race, instead of failing the caller", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "ACTIVE");
    const starter = recordingStarter();
    // The competing close() commits ACTIVE -> HELD_FOR_RECOVERY (with ITS OWN closureAttemptId,
    // "winner-attempt") between our read and our write.
    const racingStore = {
      transactWrite: async () => {
        // Commit the SAME move through the real primitive, then fail our own write exactly as
        // DynamoDB's OCC condition would have.
        await transitionTenantLifecycle({
          store,
          tableName: TABLE,
          tenantId: "org-1",
          from: "ACTIVE",
          to: "HELD_FOR_RECOVERY",
          expectedVersion: 1,
          recoveryDeadline: "2026-09-30T12:00:00.000Z",
          closureAttemptId: "winner-attempt",
        });
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      },
    };
    const service = new CloseOrganizationService(racingStore, readerFor(store), starter, TABLE, undefined, () => "loser-attempt");

    const result = await service.close(ctx(["OWNER"]));

    expect(result.transitioned).toBe(false);
    // Joins the WINNER's closureAttemptId, never the one this call generated and lost with.
    expect(starter.started).toEqual([{ name: "org-1-winner-attempt", tenantId: "org-1" }]);
  });

  it("rethrows a conflict when the re-read shows the tenant did NOT reach an in-flight state", async () => {
    const store = new InMemoryIdentityStore();
    await seed(store, "ACTIVE");
    const starter = recordingStarter();
    const conflictingStore = {
      transactWrite: async () => {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      },
    };

    await expect(new CloseOrganizationService(conflictingStore, readerFor(store), starter, TABLE).close(ctx(["OWNER"]))).rejects.toThrow();
    expect(starter.started).toEqual([]);
  });
});
