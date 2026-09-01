import { describe, expect, it } from "vitest";
import { CancelOrganizationClosureService, type ConsistentKeyValueReader, type TenantLifecycleReader } from "../../../src/modules/organization/application/cancel-organization-closure.js";
import { tenantLifecycleKey, type TenantLifecycleRecord, type TenantLifecycleStatus } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { transitionTenantLifecycle, type SystemMutationStore } from "../../../src/shared/tenant-lifecycle/system-mutation.js";
import type { TenantPurgeExecutionStopper } from "../../../src/shared/tenant-lifecycle/tenant-purge-execution-stopper.js";
import { identityMappingKey } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { globalUserKey } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { membershipKey } from "../../../src/modules/organization/domain/membership.js";
import { AuthenticationError, NotFoundError, OrganizationClosureUnavailableError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";

const TABLE = "MainTable";
const TENANT_ID = "org-1";
const COGNITO_SUB = "sub-1";
const USER_ID = "user-1";
const EXECUTION_ARN = "arn:aws:states:us-east-1:1:execution:x-tenant-purge:org-1-attempt-1";

function readerFrom(store: InMemoryIdentityStore): ConsistentKeyValueReader {
  return { get: <T>(key: { PK: string; SK: string }) => store.get<T & { PK: string; SK: string }>(key) };
}

function lifecycleReaderFrom(store: InMemoryIdentityStore): TenantLifecycleReader {
  return { read: (tenantId) => store.get<TenantLifecycleRecord>(tenantLifecycleKey(tenantId)) };
}

/** Records call order across BOTH the stopper and the store, so ordering assertions can prove
 * StopExecution happened strictly before the restoration write - not just that both happened. */
function buildTrackedDeps(store: InMemoryIdentityStore) {
  const calls: string[] = [];
  const stopper: TenantPurgeExecutionStopper = {
    stopExecution: async (input) => {
      calls.push(`stop:${input.executionArn}`);
      return { stopped: true };
    },
  };
  const trackedStore: SystemMutationStore = {
    transactWrite: async (entries) => {
      calls.push("write");
      await store.transactWrite(entries);
    },
  };
  return { calls, stopper, trackedStore };
}

async function seedIdentity(store: InMemoryIdentityStore, opts: { identityStatus?: "ACTIVE" | "SUSPENDED"; membershipStatus?: "ACTIVE" | "SUSPENDED" | "REMOVED"; membershipRole?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" } = {}): Promise<void> {
  await store.putIfAbsent({ ...identityMappingKey(COGNITO_SUB), SK: "MAP", entityType: "IdentityMapping", cognitoSub: COGNITO_SUB, userId: USER_ID, createdAt: "2026-01-01T00:00:00.000Z" });
  await store.putIfAbsent({
    ...globalUserKey(USER_ID),
    SK: "PROFILE",
    entityType: "GlobalUser",
    userId: USER_ID,
    emailNormalized: "a@b.com",
    identityStatus: opts.identityStatus ?? "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  });
  await store.putIfAbsent({
    ...membershipKey(TENANT_ID, USER_ID),
    entityType: "Membership",
    membershipId: "membership-1",
    organizationId: TENANT_ID,
    userId: USER_ID,
    role: opts.membershipRole ?? "OWNER",
    status: opts.membershipStatus ?? "ACTIVE",
    joinedAt: "2026-01-01T00:00:00.000Z",
    createdBy: USER_ID,
    version: 1,
    GSI4PK: `USER#${USER_ID}`,
    GSI4SK: `ORG#${TENANT_ID}#MEMBERSHIP#membership-1`,
  });
}

async function seedLifecycle(store: InMemoryIdentityStore, status: TenantLifecycleStatus, extra: Partial<TenantLifecycleRecord> = {}): Promise<void> {
  await store.putIfAbsent({
    ...tenantLifecycleKey(TENANT_ID),
    entityType: "TenantLifecycleRecord",
    tenantId: TENANT_ID,
    status,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    version: 1,
    ...extra,
  });
}

function build(store: InMemoryIdentityStore, stopper: TenantPurgeExecutionStopper, trackedStore: SystemMutationStore = store): CancelOrganizationClosureService {
  return new CancelOrganizationClosureService(readerFrom(store), lifecycleReaderFrom(store), trackedStore, stopper, TABLE, () => "2026-09-01T00:00:00.000Z");
}

describe("CancelOrganizationClosureService (D-127)", () => {
  it("cancels a HELD_FOR_RECOVERY closure: stops the execution, then restores ACTIVE, clearing attempt-scoped fields", async () => {
    const store = new InMemoryIdentityStore();
    await seedIdentity(store);
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN, recoveryDeadline: "2026-09-30T00:00:00.000Z" });
    const { stopper, trackedStore } = buildTrackedDeps(store);

    const result = await build(store, stopper, trackedStore).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID });

    expect(result).toEqual({ tenantId: TENANT_ID, status: "ACTIVE" });
    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey(TENANT_ID));
    expect(record?.status).toBe("ACTIVE");
    expect(record?.closureAttemptId).toBeUndefined();
    expect(record?.executionArn).toBeUndefined();
    expect(record?.recoveryDeadline).toBeUndefined();
  });

  // G-V3 target, the single most important assertion in this file: StopExecution must happen
  // BEFORE the restoration write, never after. Mutation that must fail: swapping the two calls'
  // order in cancel-organization-closure.ts (write-then-stop) makes this assertion fail because
  // "write" would appear before "stop:..." in the recorded call order.
  it("calls StopExecution strictly BEFORE the restoration write - never restore-then-stop", async () => {
    const store = new InMemoryIdentityStore();
    await seedIdentity(store);
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN });
    const { calls, stopper, trackedStore } = buildTrackedDeps(store);

    await build(store, stopper, trackedStore).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID });

    expect(calls).toEqual([`stop:${EXECUTION_ARN}`, "write"]);
  });

  it("fails the whole cancellation (no write attempted) when StopExecution itself throws - never restores with the execution possibly still alive", async () => {
    const store = new InMemoryIdentityStore();
    await seedIdentity(store);
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN });
    const { trackedStore } = buildTrackedDeps(store);
    const failingStopper: TenantPurgeExecutionStopper = {
      stopExecution: async () => {
        throw new Error("SFN unavailable");
      },
    };

    await expect(build(store, failingStopper, trackedStore).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID })).rejects.toThrow("SFN unavailable");

    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey(TENANT_ID));
    expect(record?.status).toBe("HELD_FOR_RECOVERY"); // untouched
  });

  it("fails with OrganizationClosureUnavailableError (not a silent success) when the deadline fired between the read and the write - OCC re-verification catches the race", async () => {
    const store = new InMemoryIdentityStore();
    await seedIdentity(store);
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN, version: 1 });
    // Simulate the ASL's own deadline transition landing between this service's read and its write.
    const racingStore: SystemMutationStore = {
      transactWrite: async () => {
        await transitionTenantLifecycle({ store, tableName: TABLE, tenantId: TENANT_ID, from: "HELD_FOR_RECOVERY", to: "DELETING", expectedVersion: 1 });
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      },
    };
    let stopped = false;
    const stopper: TenantPurgeExecutionStopper = { stopExecution: async () => { stopped = true; return { stopped: true }; } };

    await expect(build(store, stopper, racingStore).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID })).rejects.toBeInstanceOf(OrganizationClosureUnavailableError);
    expect(stopped).toBe(true); // StopExecution DID run (correct - it races nothing after that point)
    const record = await store.get<TenantLifecycleRecord>(tenantLifecycleKey(TENANT_ID));
    expect(record?.status).toBe("DELETING"); // the deadline's transition, not silently overwritten
  });

  it.each(["ACTIVE", "DELETING", "QUIESCING", "PURGING", "VERIFIED", "DELETED", "BLOCKED", "HELD"] as const)(
    "refuses a %s tenant outright - accepts EXCLUSIVELY HELD_FOR_RECOVERY",
    async (status) => {
      const store = new InMemoryIdentityStore();
      await seedIdentity(store);
      await seedLifecycle(store, status);
      const { stopper } = buildTrackedDeps(store);

      await expect(build(store, stopper).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID })).rejects.toBeInstanceOf(OrganizationClosureUnavailableError);
    },
  );

  it("denies ADMIN via authorizeCancelClosure (OWNER-only, same tier as organization:close)", async () => {
    const store = new InMemoryIdentityStore();
    await seedIdentity(store, { membershipRole: "ADMIN" });
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN });
    const { stopper, calls } = buildTrackedDeps(store);

    await expect(build(store, stopper).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID })).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(calls).toEqual([]); // never reached StopExecution
  });

  it("denies a SUSPENDED Membership even for an OWNER", async () => {
    const store = new InMemoryIdentityStore();
    await seedIdentity(store, { membershipStatus: "SUSPENDED" });
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN });
    const { stopper } = buildTrackedDeps(store);

    await expect(build(store, stopper).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID })).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("uses IdentityMapping -> GlobalUser -> Membership resolution, never RequestContextResolver: an unknown cognitoSub fails with AuthenticationError, not a crash", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN });
    const { stopper } = buildTrackedDeps(store);

    await expect(build(store, stopper).cancel({ cognitoSub: "unknown-sub", tenantId: TENANT_ID })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("fails with NotFoundError when the caller has no Membership in this organization at all", async () => {
    const store = new InMemoryIdentityStore();
    await store.putIfAbsent({ ...identityMappingKey(COGNITO_SUB), SK: "MAP", entityType: "IdentityMapping", cognitoSub: COGNITO_SUB, userId: USER_ID, createdAt: "2026-01-01T00:00:00.000Z" });
    await store.putIfAbsent({ ...globalUserKey(USER_ID), SK: "PROFILE", entityType: "GlobalUser", userId: USER_ID, emailNormalized: "a@b.com", identityStatus: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 });
    await seedLifecycle(store, "HELD_FOR_RECOVERY", { closureAttemptId: "attempt-1", executionArn: EXECUTION_ARN });
    const { stopper } = buildTrackedDeps(store);

    await expect(build(store, stopper).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fails with OrganizationClosureUnavailableError when HELD_FOR_RECOVERY has no executionArn/closureAttemptId attached yet, rather than guessing a StopExecution target", async () => {
    const store = new InMemoryIdentityStore();
    await seedIdentity(store);
    await seedLifecycle(store, "HELD_FOR_RECOVERY");
    const { stopper, calls } = buildTrackedDeps(store);

    await expect(build(store, stopper).cancel({ cognitoSub: COGNITO_SUB, tenantId: TENANT_ID })).rejects.toBeInstanceOf(OrganizationClosureUnavailableError);
    expect(calls).toEqual([]);
  });
});
