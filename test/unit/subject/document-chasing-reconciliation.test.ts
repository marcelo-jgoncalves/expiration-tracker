/**
 * M10 cluster 4 (D-039/D-046/D-048): proves `DocumentChasingOccurrence` claims revert through
 * the EXACT SAME claim-expiry reconciliation mechanism as `ReminderOccurrence` (D-048's plan:
 * "só o tipo TypeScript de reconcileExpiredClaims precisa alargar, o mecanismo é idêntico") -
 * no duplicated reconciliation path for chasing.
 */
import { describe, expect, it } from "vitest";
import { InMemoryReminderStore } from "../reminder/in-memory-store.js";
import { reconcileExpiredClaims } from "../../../src/workers/reminder-reconciliation/reconciliation.js";
import { documentChasingOccurrenceKey, buildChasingClaimGsi6Sk, type DocumentChasingOccurrence } from "../../../src/modules/subject/domain/document-chasing.js";
import { GSI6PK_WORKSTATE_CLAIMED } from "../../../src/modules/reminder/ports/reconciliation-candidate-source.js";

const TENANT = "t1";
const TABLE = "MainTable";

describe("reconcileExpiredClaims - DocumentChasingOccurrence (D-046/D-048)", () => {
  it("reverts an expired CLAIMED chasing occurrence back to SCHEDULED, same as a reminder claim would", async () => {
    const store = new InMemoryReminderStore();
    const claimExpiresAt = "2026-08-23T12:02:00.000Z";
    const occurrence: DocumentChasingOccurrence = {
      ...documentChasingOccurrenceKey(TENANT, "s1", "a1", "d1", "2026-08-23T12:00:00.000Z", "occ-1"),
      entityType: "DocumentChasingOccurrence",
      occurrenceId: "occ-1",
      tenantId: TENANT,
      subjectId: "s1",
      assignmentId: "a1",
      documentRequestId: "d1",
      tier: "T7",
      scheduledAt: "2026-08-23T12:00:00.000Z",
      documentRequestVersion: 1,
      shard: "00",
      shardFnVersion: 1,
      status: "CLAIMED",
      claimedAt: "2026-08-23T12:00:00.000Z",
      claimExpiresAt,
      version: 2,
      createdAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-23T12:00:00.000Z",
      GSI6PK: GSI6PK_WORKSTATE_CLAIMED,
      GSI6SK: buildChasingClaimGsi6Sk(claimExpiresAt, TENANT, "occ-1"),
    };
    await store.putIfAbsent(occurrence);

    const reverted = await reconcileExpiredClaims(
      { store, tableName: TABLE, now: () => "2026-08-23T12:05:00.000Z", shardConfig: { current: { shardFnVersion: 1, shardCount: 4 }, legacy: [] } },
      [occurrence],
    );

    expect(reverted).toBe(1);
    const row = await store.get<DocumentChasingOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(row?.status).toBe("SCHEDULED");
    expect(row?.GSI6PK).toBeUndefined();
    expect(row?.GSI6SK).toBeUndefined();
  });

  it("does not touch a chasing occurrence whose claim hasn't expired yet", async () => {
    const store = new InMemoryReminderStore();
    const claimExpiresAt = "2026-08-23T12:10:00.000Z"; // still in the future relative to now()
    const occurrence: DocumentChasingOccurrence = {
      ...documentChasingOccurrenceKey(TENANT, "s1", "a1", "d1", "2026-08-23T12:00:00.000Z", "occ-1"),
      entityType: "DocumentChasingOccurrence",
      occurrenceId: "occ-1",
      tenantId: TENANT,
      subjectId: "s1",
      assignmentId: "a1",
      documentRequestId: "d1",
      tier: "T3",
      scheduledAt: "2026-08-23T12:00:00.000Z",
      documentRequestVersion: 1,
      shard: "00",
      shardFnVersion: 1,
      status: "CLAIMED",
      claimExpiresAt,
      version: 2,
      createdAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-23T12:00:00.000Z",
    };
    await store.putIfAbsent(occurrence);

    const reverted = await reconcileExpiredClaims(
      { store, tableName: TABLE, now: () => "2026-08-23T12:05:00.000Z", shardConfig: { current: { shardFnVersion: 1, shardCount: 4 }, legacy: [] } },
      [occurrence],
    );

    expect(reverted).toBe(0);
    const row = await store.get<DocumentChasingOccurrence>({ PK: occurrence.PK, SK: occurrence.SK });
    expect(row?.status).toBe("CLAIMED");
  });
});
