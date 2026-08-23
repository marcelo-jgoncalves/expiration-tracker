import { describe, expect, it } from "vitest";
import { InMemorySubjectStore } from "./in-memory-store.js";
import { DocumentChasingMaterializer } from "../../../src/modules/subject/application/document-chasing-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import type { DocumentChasingOccurrence } from "../../../src/modules/subject/domain/document-chasing.js";

const NOW = "2026-08-23T12:00:00.000Z";

function baseInput(overrides: Partial<Parameters<DocumentChasingMaterializer["materialize"]>[0]> = {}) {
  return {
    tenantId: "tenant-1",
    subjectId: "subject-1",
    assignmentId: "assignment-1",
    documentRequestId: "docreq-1",
    documentRequestVersion: 1,
    tokenExpiresAt: "2026-09-06T12:00:00.000Z", // 14 dias à frente de NOW
    shardConfig: defaultShardConfig(),
    ...overrides,
  };
}

describe("DocumentChasingMaterializer", () => {
  it("materializes T7, T3 and EXPIRED when tokenExpiresAt is far enough in the future", async () => {
    const store = new InMemorySubjectStore();
    const materializer = new DocumentChasingMaterializer(store, () => NOW);
    const result = await materializer.materialize(baseInput());

    expect(result.skippedPast).toEqual([]);
    expect(result.created.map((o) => o.tier).sort()).toEqual(["EXPIRED", "T3", "T7"]);
    expect(result.created.every((o) => o.status === "SCHEDULED")).toBe(true);
    expect(result.created.every((o) => o.entityType === "DocumentChasingOccurrence")).toBe(true);

    const t7 = result.created.find((o) => o.tier === "T7")!;
    const t3 = result.created.find((o) => o.tier === "T3")!;
    const expired = result.created.find((o) => o.tier === "EXPIRED")!;
    expect(t7.scheduledAt).toBe("2026-08-30T12:00:00.000Z"); // 7 dias antes de tokenExpiresAt
    expect(t3.scheduledAt).toBe("2026-09-03T12:00:00.000Z"); // 3 dias antes
    expect(expired.scheduledAt).toBe("2026-09-06T12:00:00.000Z"); // exatamente tokenExpiresAt
  });

  it("skips a tier whose computed schedule already passed, but always materializes EXPIRED", async () => {
    const store = new InMemorySubjectStore();
    const materializer = new DocumentChasingMaterializer(store, () => NOW);
    // tokenExpiresAt a só 2 dias de NOW: T7 e T3 caem no passado, só EXPIRED é futuro.
    const result = await materializer.materialize(baseInput({ tokenExpiresAt: "2026-08-25T12:00:00.000Z" }));

    expect(result.skippedPast.sort()).toEqual(["T3", "T7"]);
    expect(result.created.map((o) => o.tier)).toEqual(["EXPIRED"]);
  });

  it("is idempotent - calling materialize twice with the same input creates nothing new the second time", async () => {
    const store = new InMemorySubjectStore();
    const materializer = new DocumentChasingMaterializer(store, () => NOW);
    const first = await materializer.materialize(baseInput());
    const second = await materializer.materialize(baseInput());

    expect(first.created).toHaveLength(3);
    expect(second.created).toHaveLength(0);
    expect(second.skippedExisting).toBe(3);
  });

  it("a new documentRequestVersion produces different occurrenceIds (never collides with the stale generation)", async () => {
    const store = new InMemorySubjectStore();
    const materializer = new DocumentChasingMaterializer(store, () => NOW);
    const v1 = await materializer.materialize(baseInput({ documentRequestVersion: 1 }));
    const v2 = await materializer.materialize(baseInput({ documentRequestVersion: 2 }));

    const v1Ids = v1.created.map((o) => o.occurrenceId).sort();
    const v2Ids = v2.created.map((o) => o.occurrenceId).sort();
    expect(v1Ids).toHaveLength(3);
    expect(v2Ids).toHaveLength(3);
    expect(v1Ids).not.toEqual(v2Ids);
  });

  it("writes non-overlapping GSI3SK shape from ReminderOccurrence (CHASING# vs OCCURRENCE#)", async () => {
    const store = new InMemorySubjectStore();
    const materializer = new DocumentChasingMaterializer(store, () => NOW);
    const result = await materializer.materialize(baseInput());
    for (const occurrence of result.created) {
      expect(occurrence.GSI3SK).toMatch(/^TENANT#tenant-1#CHASING#chase_[0-9a-f]+$/);
    }
  });

  it("co-locates occurrences under the subject partition, nested under the assignment/documentRequest path", async () => {
    const store = new InMemorySubjectStore();
    const materializer = new DocumentChasingMaterializer(store, () => NOW);
    const result = await materializer.materialize(baseInput());
    for (const occurrence of result.created) {
      expect(occurrence.PK).toBe("TENANT#tenant-1#SUBJECT#subject-1");
      expect(occurrence.SK).toMatch(/^REQASSIGN#assignment-1#DOCREQ#docreq-1#CHASING#/);
    }
  });

  it("persisted occurrences round-trip through the store exactly as materialized", async () => {
    const store = new InMemorySubjectStore();
    const materializer = new DocumentChasingMaterializer(store, () => NOW);
    const result = await materializer.materialize(baseInput());
    const t7 = result.created.find((o) => o.tier === "T7")!;
    const fetched = await store.get<DocumentChasingOccurrence>({ PK: t7.PK, SK: t7.SK });
    expect(fetched).toEqual(t7);
  });
});
