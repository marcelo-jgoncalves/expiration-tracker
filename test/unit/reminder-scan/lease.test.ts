import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "../reminder/in-memory-store.js";
import {
  buildAcquireLeaseTransaction,
  buildReclaimLeaseTransaction,
  buildCheckpointLeaseTransaction,
  leaseKey,
  GSI6PK_SCANLEASE_IN_PROGRESS,
  type LeaseTransitionDeps,
  type ReminderScanLease,
} from "../../../src/workers/reminder-scan/lease.js";
import { serializeCanonicalKey } from "../../../src/shared/dynamodb/canonical-key.js";
import { defaultSchemaRegistry } from "../../../src/shared/contracts/schema-validator.js";

const REF = { shardFnVersion: 1, shardId: 3, minuteISO: "2026-09-14T12:00:00.000Z" };
const TABLE = "MainTable";
const LEASE_DURATION_MS = 200_000;

function deps(nowIso: string, overrides: Partial<LeaseTransitionDeps> = {}): LeaseTransitionDeps {
  let counter = 0;
  return {
    tableName: TABLE,
    now: () => nowIso,
    newEventId: () => `evt-${++counter}`,
    correlationId: () => "corr-1",
    rolloutEpoch: 1,
    ...overrides,
  };
}

describe("buildAcquireLeaseTransaction (D-300 §2 row 1)", () => {
  it("succeeds when no lease item exists yet, sets version:1/pagesProcessed:0/GSI6 pointer, appends a start continuation", async () => {
    const store = new InMemoryReminderStore();
    const { tx } = buildAcquireLeaseTransaction(deps("2026-09-14T12:00:05.000Z"), REF, "owner-A", LEASE_DURATION_MS);

    await store.transactWrite(tx);

    const item = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(item?.status).toBe("IN_PROGRESS");
    expect(item?.version).toBe(1);
    expect(item?.pagesProcessed).toBe(0);
    expect(item?.ownerToken).toBe("owner-A");
    expect(item?.GSI6PK).toBe(GSI6PK_SCANLEASE_IN_PROGRESS);
    expect(item?.lastEvaluatedKey).toBeUndefined();

    // Continuation outbox entry (2nd tx entry) carries data.lastEvaluatedKey undefined (page 1 start).
    expect(tx).toHaveLength(2);
    const outboxPut = (tx[1] as { Put: { Item: Record<string, unknown> } }).Put.Item;
    expect(outboxPut["destination"]).toBe("SQS_REMINDER_SCAN_CONTINUATION_V1");
    expect((outboxPut["payload"] as Record<string, unknown>)["tenantId"]).toBe("SYSTEM");
    // Real bug found live during D-300 revalidation (2026-09-15): this outbox record's
    // aggregateVersion used to be hardcoded 0, which domain-event-envelope.v1.json's schema
    // rejects (aggregate.version must be >= 1) - every continuation event silently failed the
    // relay's own schema validation forever, so no message ever reached the real scan queue.
    // Proven fixed: aggregateVersion must always be >= 1.
    expect(outboxPut["aggregateVersion"]).toBe(1);
  });

  it("THE OLD BUG: without attribute_not_exists(PK), two concurrent ticks could both acquire the same lease - proven fixed: a second acquire attempt on an already-existing lease is rejected", async () => {
    const store = new InMemoryReminderStore();
    await store.transactWrite(buildAcquireLeaseTransaction(deps("2026-09-14T12:00:05.000Z"), REF, "owner-A", LEASE_DURATION_MS).tx);

    const second = buildAcquireLeaseTransaction(deps("2026-09-14T12:00:06.000Z"), REF, "owner-B", LEASE_DURATION_MS);
    await expect(store.transactWrite(second.tx)).rejects.toMatchObject({ name: "TransactionCanceledException" });
  });
});

describe("buildReclaimLeaseTransaction (D-300 §2 row 2)", () => {
  it("succeeds only once the lease's leaseUntil has passed - resets version/counters/ownerToken, restarts from page 1", async () => {
    const store = new InMemoryReminderStore();
    // owner-A acquires at 12:00:05, leaseUntil = 12:00:05 + 200s = 12:03:25.
    await store.transactWrite(buildAcquireLeaseTransaction(deps("2026-09-14T12:00:05.000Z"), REF, "owner-A", LEASE_DURATION_MS).tx);

    // THE OLD BUG this condition prevents: reclaiming a lease whose owner is still alive would
    // let a concurrent invocation steal an active scan out from under its real owner, causing
    // double-processing / lost checkpoints. Proven fixed: reclaim BEFORE leaseUntil is rejected.
    const tooEarly = buildReclaimLeaseTransaction(deps("2026-09-14T12:01:00.000Z"), REF, "owner-B", LEASE_DURATION_MS);
    await expect(store.transactWrite(tooEarly.tx)).rejects.toMatchObject({ name: "TransactionCanceledException" });

    // After leaseUntil passes, reclaim succeeds - new owner, version reset to 1.
    const reclaim = buildReclaimLeaseTransaction(deps("2026-09-14T12:03:30.000Z"), REF, "owner-B", LEASE_DURATION_MS);
    await store.transactWrite(reclaim.tx);

    const item = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(item?.ownerToken).toBe("owner-B");
    expect(item?.version).toBe(1);
    expect(item?.pagesProcessed).toBe(0);
    expect(item?.status).toBe("IN_PROGRESS");
  });
});

describe("buildCheckpointLeaseTransaction (D-300 §2 rows 3/4) - two distinct condition branches, never an OR", () => {
  it("page-1 checkpoint (more pages remain) requires attribute_not_exists(lastEvaluatedKey), advances lastEvaluatedKey/leaseUntil, appends continuation", async () => {
    const store = new InMemoryReminderStore();
    const acquireDeps = deps("2026-09-14T12:00:05.000Z");
    await store.transactWrite(buildAcquireLeaseTransaction(acquireDeps, REF, "owner-A", LEASE_DURATION_MS).tx);
    const afterAcquire = await store.get<ReminderScanLease>(leaseKey(REF));

    const nextKey = serializeCanonicalKey({ PK: "TABLE#p", SK: "s" });
    const checkpointDeps = deps("2026-09-14T12:00:10.000Z");
    const tx = buildCheckpointLeaseTransaction(checkpointDeps, {
      ref: REF,
      ownerToken: "owner-A",
      expectedVersion: afterAcquire!.version,
      startedFromLastEvaluatedKey: undefined,
      nextLastEvaluatedKey: nextKey,
      pagesProcessedTotal: 1,
      candidatesPublishedTotal: 50,
      leaseDurationMs: LEASE_DURATION_MS,
    });
    await store.transactWrite(tx);

    const item = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(item?.status).toBe("IN_PROGRESS");
    expect(item?.lastEvaluatedKey).toBe(nextKey);
    expect(item?.version).toBe(2);
    expect(tx).toHaveLength(2); // still has continuation outbox entry

    // Rejected if attempted a second time from page 1 (lastEvaluatedKey now exists) - proves the
    // branch actually discriminates page-1 vs continuation, not just accepts anything.
    const replay = buildCheckpointLeaseTransaction(checkpointDeps, {
      ref: REF,
      ownerToken: "owner-A",
      expectedVersion: afterAcquire!.version,
      startedFromLastEvaluatedKey: undefined,
      nextLastEvaluatedKey: serializeCanonicalKey({ PK: "TABLE#other", SK: "s" }),
      pagesProcessedTotal: 1,
      candidatesPublishedTotal: 1,
      leaseDurationMs: LEASE_DURATION_MS,
    });
    await expect(store.transactWrite(replay)).rejects.toMatchObject({ name: "TransactionCanceledException" });
  });

  it("THE OLD BUG (successor-before-predecessor's-checkpoint race): a stale continuation whose startedFrom key no longer matches the lease's current lastEvaluatedKey is rejected, not silently overwritten", async () => {
    const store = new InMemoryReminderStore();
    await store.transactWrite(buildAcquireLeaseTransaction(deps("2026-09-14T12:00:05.000Z"), REF, "owner-A", LEASE_DURATION_MS).tx);
    let lease = await store.get<ReminderScanLease>(leaseKey(REF));

    const key1 = serializeCanonicalKey({ PK: "P1", SK: "S1" });
    await store.transactWrite(
      buildCheckpointLeaseTransaction(deps("2026-09-14T12:00:10.000Z"), {
        ref: REF,
        ownerToken: "owner-A",
        expectedVersion: lease!.version,
        startedFromLastEvaluatedKey: undefined,
        nextLastEvaluatedKey: key1,
        pagesProcessedTotal: 1,
        candidatesPublishedTotal: 10,
        leaseDurationMs: LEASE_DURATION_MS,
      }),
    );
    lease = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(lease?.lastEvaluatedKey).toBe(key1);

    // A duplicate/stale message for the SAME page (still believes lastEvaluatedKey is undefined,
    // i.e. it thinks it's processing page 1) tries to checkpoint again - must be rejected because
    // the lease has already moved past that position (successor-before-predecessor scenario the
    // DECISION doc calls out as "agora provavelmente impossível, testado").
    const staleReplay = buildCheckpointLeaseTransaction(deps("2026-09-14T12:00:11.000Z"), {
      ref: REF,
      ownerToken: "owner-A",
      expectedVersion: lease!.version,
      startedFromLastEvaluatedKey: undefined,
      nextLastEvaluatedKey: serializeCanonicalKey({ PK: "P2", SK: "S2" }),
      pagesProcessedTotal: 1,
      candidatesPublishedTotal: 10,
      leaseDurationMs: LEASE_DURATION_MS,
    });
    await expect(store.transactWrite(staleReplay)).rejects.toMatchObject({ name: "TransactionCanceledException" });

    // The CORRECT successor (startedFromLastEvaluatedKey === key1) succeeds and can complete.
    const finalTx = buildCheckpointLeaseTransaction(deps("2026-09-14T12:00:12.000Z"), {
      ref: REF,
      ownerToken: "owner-A",
      expectedVersion: lease!.version,
      startedFromLastEvaluatedKey: key1,
      nextLastEvaluatedKey: undefined,
      pagesProcessedTotal: 1,
      candidatesPublishedTotal: 5,
      leaseDurationMs: LEASE_DURATION_MS,
    });
    expect(finalTx).toHaveLength(1); // COMPLETED: no continuation outbox entry
    await store.transactWrite(finalTx);

    const completed = await store.get<ReminderScanLease>(leaseKey(REF));
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.GSI6PK).toBeUndefined();
    expect(completed?.GSI6SK).toBeUndefined();
  });
});

describe("continuation outbox records pass real outbox-record.v1.json schema validation (D-300 revalidation, 2026-09-15)", () => {
  // THE REAL BUG this whole describe block exists to catch: appendContinuationOutbox used to
  // hardcode aggregate.version: 0. Every unit test above builds/inspects these transactions with
  // an in-memory fake that never runs them through the SAME schema validation the real
  // dispatch-outbox-relay-handler.ts applies before forwarding to SQS - so this bug shipped
  // through 12 commits of "real, gate-verified" work and was only caught live in a deployed dev
  // burst test, via a CloudWatch Logs query showing "dispatch-outbox-relay schema-invalid
  // OutboxEvent image" / "/aggregateVersion must be >= 1" repeating forever. This test closes
  // that specific gap: validate the ACTUAL outbox Put Item against the ACTUAL schema the relay
  // uses, for every one of the three lease transitions.
  const SCHEMA_ID = "https://expiration-tracker/schemas/events/outbox-record.v1.json";

  function validateContinuationOutboxEntry(tx: ReturnType<typeof buildAcquireLeaseTransaction>["tx"]): void {
    const outboxPut = tx.find((e) => "Put" in e && (e.Put.Item as Record<string, unknown>)["entityType"] === "OutboxEvent") as { Put: { Item: Record<string, unknown> } } | undefined;
    expect(outboxPut).toBeDefined();
    const { valid, errors } = defaultSchemaRegistry.validate(SCHEMA_ID, outboxPut!.Put.Item);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  }

  it("acquire's continuation outbox record is schema-valid", () => {
    const { tx } = buildAcquireLeaseTransaction(deps("2026-09-14T12:00:05.000Z"), REF, "owner-A", LEASE_DURATION_MS);
    validateContinuationOutboxEntry(tx);
  });

  it("reclaim's continuation outbox record is schema-valid", () => {
    const { tx } = buildReclaimLeaseTransaction(deps("2026-09-14T12:03:30.000Z"), REF, "owner-B", LEASE_DURATION_MS);
    validateContinuationOutboxEntry(tx);
  });

  it("checkpoint's (more-pages) continuation outbox record is schema-valid", () => {
    const tx = buildCheckpointLeaseTransaction(deps("2026-09-14T12:00:10.000Z"), {
      ref: REF,
      ownerToken: "owner-A",
      expectedVersion: 1,
      startedFromLastEvaluatedKey: undefined,
      nextLastEvaluatedKey: serializeCanonicalKey({ PK: "P1", SK: "S1" }),
      pagesProcessedTotal: 1,
      candidatesPublishedTotal: 10,
      leaseDurationMs: LEASE_DURATION_MS,
    });
    validateContinuationOutboxEntry(tx);
  });
});
