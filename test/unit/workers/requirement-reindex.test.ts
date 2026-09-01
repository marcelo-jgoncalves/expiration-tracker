import { describe, expect, it } from "vitest";
import { runRequirementReindex } from "../../../src/workers/requirement-reindex/reindex.js";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import { requirementGsi1Keys, requirementKey, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

/** `InMemoryDocumentArchiveStore`'s seed parameter is typed `Record<string, unknown> &
 * EntityKey` (an open shape it stores generically), while `Requirement` is a closed interface
 * with no index signature — this narrows the same real object down for the constructor without
 * a runtime copy, same cast `document-archive-service.test.ts`'s helpers use elsewhere. */
function seed(...requirements: Requirement[]): (Record<string, unknown> & EntityKey)[] {
  return requirements as unknown as (Record<string, unknown> & EntityKey)[];
}

const TABLE = "test-table";
const TENANT = "tenant-1";
const SUBJECT = "subject-1";
const NOW = "2026-09-01T00:00:00.000Z";

function makeSatisfiedRequirement(overrides: Partial<Requirement> = {}): Requirement {
  const requirementId = overrides.requirementId ?? "req-1";
  const status = "SATISFIED";
  return {
    ...requirementKey(TENANT, SUBJECT, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId: TENANT,
    subjectId: SUBJECT,
    name: "CND Federal",
    applicability: "APPLICABLE",
    status,
    evidenceVersionId: "ver-1",
    evidenceDocumentId: "doc-1",
    evidenceSeq: 1,
    evidenceState: "ACCEPTED",
    evidenceValidUntil: "2026-08-01T00:00:00.000Z", // in the past relative to NOW, by default
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...requirementGsi1Keys(TENANT, status, "2026-01-01T00:00:00.000Z", requirementId),
    ...overrides,
  };
}

describe("runRequirementReindex (D-143 Decision 5: daily time-based drift)", () => {
  it("transitions a SATISFIED Requirement whose evidenceValidUntil has passed to NOT_SATISFIED", async () => {
    const requirement = makeSatisfiedRequirement();
    const store = new InMemoryDocumentArchiveStore(seed(requirement));

    const result = await runRequirementReindex({ store, tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 1, transitioned: 1, skippedConcurrentlyModified: 0 });

    const updated = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirement.requirementId));
    expect(updated?.status).toBe("NOT_SATISFIED");
    expect(updated?.GSI1PK).toBe(`TENANT#${TENANT}#REQSTATUS#NOT_SATISFIED`);
    expect(updated?.version).toBe(2);
  });

  it("leaves a SATISFIED Requirement alone when evidenceValidUntil is still in the future", async () => {
    const requirement = makeSatisfiedRequirement({ evidenceValidUntil: "2026-12-31T00:00:00.000Z" });
    const store = new InMemoryDocumentArchiveStore(seed(requirement));

    const result = await runRequirementReindex({ store, tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 1, transitioned: 0, skippedConcurrentlyModified: 0 });
  });

  it("leaves a SATISFIED Requirement alone when it has no evidenceValidUntil (never expires)", async () => {
    const requirement = makeSatisfiedRequirement({ evidenceValidUntil: undefined });
    const store = new InMemoryDocumentArchiveStore(seed(requirement));

    const result = await runRequirementReindex({ store, tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 1, transitioned: 0, skippedConcurrentlyModified: 0 });
  });

  it("ignores MISSING/PENDING/NOT_SATISFIED/NOT_APPLICABLE Requirements entirely (scan is pre-filtered to SATISFIED)", async () => {
    const store = new InMemoryDocumentArchiveStore([
      { ...requirementKey(TENANT, SUBJECT, "req-missing"), entityType: "Requirement", requirementId: "req-missing", tenantId: TENANT, subjectId: SUBJECT, name: "x", applicability: "APPLICABLE", status: "MISSING", createdAt: NOW, updatedAt: NOW, version: 1, ...requirementGsi1Keys(TENANT, "MISSING", NOW, "req-missing") },
    ]);
    const result = await runRequirementReindex({ store, tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 0, transitioned: 0, skippedConcurrentlyModified: 0 });
  });

  it("processes multiple SATISFIED Requirements across tenants in one run", async () => {
    const r1 = makeSatisfiedRequirement({ requirementId: "req-1", tenantId: "tenant-a", ...requirementKey("tenant-a", SUBJECT, "req-1") });
    const r2 = makeSatisfiedRequirement({ requirementId: "req-2", tenantId: "tenant-b", ...requirementKey("tenant-b", SUBJECT, "req-2") });
    const store = new InMemoryDocumentArchiveStore(seed(r1, r2));

    const result = await runRequirementReindex({ store, tableName: TABLE, now: () => NOW });
    expect(result.scanned).toBe(2);
    expect(result.transitioned).toBe(2);
  });

  it("skips (never throws) a Requirement that was concurrently modified since the scan read it", async () => {
    const requirement = makeSatisfiedRequirement();
    const store = new InMemoryDocumentArchiveStore(seed(requirement));
    // Simulate a concurrent write bumping the version between the scan and this worker's own
    // conditioned update (e.g. a caller's own unlinkEvidence racing the daily job).
    const realTransactWrite = store.transactWrite.bind(store);
    let callCount = 0;
    store.transactWrite = async (entries) => {
      callCount += 1;
      if (callCount === 1) {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      }
      return realTransactWrite(entries);
    };

    const result = await runRequirementReindex({ store, tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 1, transitioned: 0, skippedConcurrentlyModified: 1 });
  });
});
