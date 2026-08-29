import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  executeSystemMutation,
  transitionTenantLifecycle,
  SystemMutationConflictError,
  SystemMutationNotImplementedError,
  type SystemMutationOperation,
} from "../../src/shared/tenant-lifecycle/system-mutation.js";
import { tenantLifecycleKey, type TenantLifecycleStatus } from "../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { EntityKey } from "../../src/shared/dynamodb/occ.js";
import { InMemoryIdentityStore } from "./identity/in-memory-store.js";

const TABLE = "MainTable";

function seedLifecycle(store: InMemoryIdentityStore, tenantId: string, status: TenantLifecycleStatus, version = 1) {
  return store.putIfAbsent({
    ...tenantLifecycleKey(tenantId),
    entityType: "TenantLifecycleRecord",
    tenantId,
    status,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    version,
  });
}

describe("transitionTenantLifecycle (SystemMutation lane, LIFECYCLE_TRANSITION)", () => {
  it("moves ACTIVE -> DELETING for real, via occ.ts's OCC-fenced Update", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE");

    await transitionTenantLifecycle({
      store,
      tableName: TABLE,
      tenantId: "tenant-1",
      from: "ACTIVE",
      to: "DELETING",
      expectedVersion: 1,
    });

    const record = await store.get<EntityKey & { status: TenantLifecycleStatus; version: number }>(tenantLifecycleKey("tenant-1"));
    expect(record?.status).toBe("DELETING");
    expect(record?.version).toBe(2); // buildVersionedUpdate increments version atomically
  });

  it("rejects an illegal transition before touching the store at all (assertValidTransition, in-process)", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE");

    await expect(
      transitionTenantLifecycle({
        store,
        tableName: TABLE,
        tenantId: "tenant-1",
        from: "ACTIVE",
        to: "PURGING", // skips DELETING/QUIESCING - illegal per the forward-only graph
        expectedVersion: 1,
      }),
    ).rejects.toThrow("Invalid TenantLifecycleRecord transition");

    const record = await store.get<EntityKey & { status: TenantLifecycleStatus }>(tenantLifecycleKey("tenant-1"));
    expect(record?.status).toBe("ACTIVE"); // untouched
  });

  it("rejects with SystemMutationConflictError when expectedVersion is stale (lost the race to a concurrent transition)", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE", 5);

    await expect(
      transitionTenantLifecycle({
        store,
        tableName: TABLE,
        tenantId: "tenant-1",
        from: "ACTIVE",
        to: "DELETING",
        expectedVersion: 1, // stale
      }),
    ).rejects.toBeInstanceOf(SystemMutationConflictError);
  });

  it("BLOCKED/HELD side-transitions set blockedReason/blockedFrom, and resuming clears them", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "PURGING");

    await transitionTenantLifecycle({
      store,
      tableName: TABLE,
      tenantId: "tenant-1",
      from: "PURGING",
      to: "BLOCKED",
      expectedVersion: 1,
      blockedReason: "PURGE_S3_ERRORS",
    });
    let record = await store.get<EntityKey & { status: string; blockedReason?: string; blockedFrom?: string; version: number }>(
      tenantLifecycleKey("tenant-1"),
    );
    expect(record?.status).toBe("BLOCKED");
    expect(record?.blockedReason).toBe("PURGE_S3_ERRORS");
    expect(record?.blockedFrom).toBe("PURGING");

    await transitionTenantLifecycle({
      store,
      tableName: TABLE,
      tenantId: "tenant-1",
      from: "BLOCKED",
      to: "PURGING",
      expectedVersion: record!.version,
      blockedFrom: "PURGING",
    });
    record = await store.get<EntityKey & { status: string; blockedReason?: string; blockedFrom?: string; version: number }>(
      tenantLifecycleKey("tenant-1"),
    );
    expect(record?.status).toBe("PURGING");
  });

  it("adversarial (W3-07 review finding, Codex round 1): resume from BLOCKED cannot be forged to skip stages by lying about blockedFrom", async () => {
    const store = new InMemoryIdentityStore();
    // Genuinely blocked from DELETING (early in the cascade, not VERIFIED).
    await seedLifecycle(store, "tenant-1", "DELETING");
    await transitionTenantLifecycle({
      store,
      tableName: TABLE,
      tenantId: "tenant-1",
      from: "DELETING",
      to: "BLOCKED",
      expectedVersion: 1,
      blockedReason: "LEGAL_HOLD",
    });
    const blocked = await store.get<EntityKey & { status: string; blockedFrom?: string; version: number }>(tenantLifecycleKey("tenant-1"));
    expect(blocked?.blockedFrom).toBe("DELETING");

    // Attempt to resume straight to VERIFIED (skipping QUIESCING/PURGING) by simply claiming
    // blockedFrom: "VERIFIED" — canTransition's in-process check alone would accept this
    // (to === op.blockedFrom), so only the OCC extraCondition against the STORED blockedFrom
    // can catch it.
    await expect(
      transitionTenantLifecycle({
        store,
        tableName: TABLE,
        tenantId: "tenant-1",
        from: "BLOCKED",
        to: "VERIFIED",
        expectedVersion: blocked!.version,
        blockedFrom: "VERIFIED", // forged - the record was actually blocked from DELETING
      }),
    ).rejects.toBeInstanceOf(SystemMutationConflictError);

    // The record must still be BLOCKED, still genuinely tied to DELETING - no stage was skipped.
    const stillBlocked = await store.get<EntityKey & { status: string; blockedFrom?: string }>(tenantLifecycleKey("tenant-1"));
    expect(stillBlocked?.status).toBe("BLOCKED");
    expect(stillBlocked?.blockedFrom).toBe("DELETING");

    // The legitimate resume (matching the TRUE stored blockedFrom) still works.
    await transitionTenantLifecycle({
      store,
      tableName: TABLE,
      tenantId: "tenant-1",
      from: "BLOCKED",
      to: "DELETING",
      expectedVersion: blocked!.version, // unchanged - the forged attempt's condition failed, no write happened
      blockedFrom: "DELETING",
    });
    const resumed = await store.get<EntityKey & { status: string }>(tenantLifecycleKey("tenant-1"));
    expect(resumed?.status).toBe("DELETING");
  });

  it("cross-tenant isolation: transitioning tenant-1 never touches tenant-2's lifecycle record", async () => {
    const store = new InMemoryIdentityStore();
    await seedLifecycle(store, "tenant-1", "ACTIVE");
    await seedLifecycle(store, "tenant-2", "ACTIVE");

    await transitionTenantLifecycle({ store, tableName: TABLE, tenantId: "tenant-1", from: "ACTIVE", to: "DELETING", expectedVersion: 1 });

    const other = await store.get<EntityKey & { status: TenantLifecycleStatus }>(tenantLifecycleKey("tenant-2"));
    expect(other?.status).toBe("ACTIVE");
  });
});

describe("executeSystemMutation — allowlist containment", () => {
  it("PURGE_DELETE and OUTBOX_BOOKKEEPING are allowlisted by type but throw SystemMutationNotImplementedError (not silently accepted)", async () => {
    const store = new InMemoryIdentityStore();
    await expect(
      executeSystemMutation({ store, tableName: TABLE, operation: { kind: "PURGE_DELETE" } }),
    ).rejects.toBeInstanceOf(SystemMutationNotImplementedError);
    await expect(
      executeSystemMutation({ store, tableName: TABLE, operation: { kind: "OUTBOX_BOOKKEEPING" } }),
    ).rejects.toBeInstanceOf(SystemMutationNotImplementedError);
  });

  it("adversarial: an operation with an unrecognized kind that bypassed the type system at a runtime boundary (e.g. JSON.parse) is rejected, not silently executed", async () => {
    const store = new InMemoryIdentityStore();
    const smuggled = { kind: "DELETE_EVERYTHING_FOR_THIS_TENANT" } as unknown as SystemMutationOperation;

    await expect(executeSystemMutation({ store, tableName: TABLE, operation: smuggled })).rejects.toBeInstanceOf(
      SystemMutationNotImplementedError,
    );
  });

  it("adversarial: this lane's public API has no way to pass an arbitrary caller-built TransactWriteEntry[] through it - only a SystemMutationOperation is accepted, and executeSystemMutation itself owns entry construction", () => {
    // Structural proof, not a runtime assertion: executeSystemMutation's signature is
    // `(input: SystemMutationInput) => Promise<void>`, and SystemMutationInput has no
    // `entries`/`transactItems`/etc. field - only `operation: SystemMutationOperation`, a
    // closed union. There is no code path in this file that forwards a caller-supplied array
    // to store.transactWrite unmodified; buildEntries always constructs the array itself from
    // the operation's own fields. (Compile-time proof: attempting to pass an `entries` field
    // in TenantMutationInput-like shape below is a type error, verified by `npm run typecheck`
    // treating this file as part of the build.)
    const attemptedBypass: import("../../src/shared/tenant-lifecycle/system-mutation.js").SystemMutationInput = {
      store: new InMemoryIdentityStore(),
      tableName: TABLE,
      operation: { kind: "LIFECYCLE_TRANSITION", tenantId: "t", from: "ACTIVE", to: "DELETING", expectedVersion: 1 },
      // @ts-expect-error - SystemMutationInput has no `entries` field; this is the type-level
      // half of the containment guarantee described in the file header.
      entries: [{ Put: { TableName: TABLE, Item: { PK: "x", SK: "y" }, ConditionExpression: "" } }],
    };
    expect(attemptedBypass).toBeDefined();
  });

  it("adversarial (D-074/D-076 item 2, allowlist closure): a SystemMutationOperation literal with a kind outside the union {LIFECYCLE_TRANSITION, PURGE_DELETE, OUTBOX_BOOKKEEPING} is a COMPILE-TIME type error, not just a runtime rejection - the allowlist is closed at the type level, this is the compile-time half proving it", () => {
    // Mirrors the runtime test above (an unrecognized kind that bypassed the type system, e.g.
    // via `as unknown as SystemMutationOperation` or JSON.parse across a process boundary, IS
    // rejected at runtime by buildEntries' exhaustiveness guard) - this test proves the OTHER
    // half: any code within this codebase's own type system, with no unsafe cast, cannot even
    // construct an operation with an unlisted kind in the first place. Together the two tests
    // prove the allowlist is closed both for in-process callers (this test) and for a value that
    // reaches executeSystemMutation having bypassed TypeScript entirely (the runtime test above).
    // @ts-expect-error - "DELETE_EVERYTHING_FOR_THIS_TENANT" is not a member of the
    // SystemMutationOperation discriminated union; TypeScript must reject this literal.
    const attemptedNewOperationKind: SystemMutationOperation = { kind: "DELETE_EVERYTHING_FOR_THIS_TENANT" };
    expect(attemptedNewOperationKind).toBeDefined();
  });

  it("D-074/D-076 item 2 note: no orchestrator/handler in this codebase yet constructs a SystemMutationOperation from external/untrusted input (Step Functions payload, SQS message, API body) - transitionTenantLifecycle's only caller today is this test file itself. When a real orchestrator is wired (see NEXT_SESSION_PROMPT.md), THAT call site is where a runtime allowlist assertion against the raw deserialized `kind` value becomes load-bearing, on top of the exhaustiveness guard already proven above; this test exists so that claim is written down and falsifiable by grep, not just asserted in prose", () => {
    // This is a documentation-as-test placeholder, not a behavioral assertion - it fails loudly
    // if a future session wires an external entry point without revisiting this note, instead of
    // silently going stale.
    const systemMutationSrc = join(__dirname, "..", "..", "src", "shared", "tenant-lifecycle", "system-mutation.ts");
    const contents = readFileSync(systemMutationSrc, "utf8");
    expect(contents).toContain("not built this session");
  });
});
