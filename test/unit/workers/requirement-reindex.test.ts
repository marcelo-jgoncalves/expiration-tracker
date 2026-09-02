import { describe, expect, it } from "vitest";
import { runRequirementReindex } from "../../../src/workers/requirement-reindex/reindex.js";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import { requirementGsi1Keys, requirementGsi8Keys, requirementKey, type Requirement } from "../../../src/modules/document-archive/domain/requirement.js";
import type { RequirementGsi8Candidate, RequirementGsi8Page, RequirementReindexCandidateSource } from "../../../src/workers/requirement-reindex/candidate-source.js";
import { buildVersionedUpdate, type EntityKey } from "../../../src/shared/dynamodb/occ.js";

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
  const tenantId = overrides.tenantId ?? TENANT;
  const status = "SATISFIED";
  const evidenceValidUntil = overrides.evidenceValidUntil !== undefined || "evidenceValidUntil" in overrides ? overrides.evidenceValidUntil : "2026-08-01T00:00:00.000Z"; // in the past relative to NOW, by default
  return {
    ...requirementKey(tenantId, SUBJECT, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId,
    subjectId: SUBJECT,
    name: "CND Federal",
    applicability: "APPLICABLE",
    status,
    evidenceVersionId: "ver-1",
    evidenceDocumentId: "doc-1",
    evidenceSeq: 1,
    evidenceState: "ACCEPTED",
    ...(evidenceValidUntil !== undefined ? { evidenceValidUntil } : {}),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...requirementGsi1Keys(tenantId, status, "2026-01-01T00:00:00.000Z", requirementId),
    ...(evidenceValidUntil !== undefined ? requirementGsi8Keys({ dueAtIso: evidenceValidUntil, tenantId, requirementId }) : {}),
    ...overrides,
  };
}

/** Fake mirroring the real DynamoDB GSI8 Query's contract (`GSI8PK = "WORK#..." AND GSI8SK <
 * :before`, ordered by due date, `tenantId`/`subjectId`/`requirementId` parsed off the base
 * PK/SK) - reads live off the SAME store the worker's transactional writes land in, same
 * discipline `document-file-reconciliation.test.ts`'s fake uses. */
function fakeCandidateSource(store: InMemoryDocumentArchiveStore): RequirementReindexCandidateSource {
  return {
    async queryDue(input: { before: string }): Promise<RequirementGsi8Page> {
      const items: RequirementGsi8Candidate[] = store
        .allItems()
        .filter((item): item is EntityKey & Record<string, unknown> => item["entityType"] === "Requirement" && typeof item["GSI8SK"] === "string" && (item["GSI8SK"] as string) < input.before)
        .map((item) => {
          const gsi8sk = item["GSI8SK"] as string;
          const requirement = item as unknown as Requirement;
          return { PK: requirement.PK, SK: requirement.SK, dueAtIso: gsi8sk.split("#TENANT#")[0]!, tenantId: requirement.tenantId, subjectId: requirement.subjectId, requirementId: requirement.requirementId };
        })
        .sort((a, b) => a.dueAtIso.localeCompare(b.dueAtIso));
      return { items };
    },
  };
}

describe("runRequirementReindex (D-143 Decision 5: daily time-based drift, migrated to GSI8 by D-179/D-185)", () => {
  it("transitions a SATISFIED Requirement whose evidenceValidUntil has passed to NOT_SATISFIED, and clears the GSI8 pointer", async () => {
    const requirement = makeSatisfiedRequirement();
    const store = new InMemoryDocumentArchiveStore(seed(requirement));

    const result = await runRequirementReindex({ store, candidates: fakeCandidateSource(store), tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 1, transitioned: 1, skippedConcurrentlyModified: 0, skippedNotDue: 0, oldestCandidateAgeSeconds: expect.any(Number) });

    const updated = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirement.requirementId));
    expect(updated?.status).toBe("NOT_SATISFIED");
    expect(updated?.GSI1PK).toBe(`TENANT#${TENANT}#REQSTATUS#NOT_SATISFIED`);
    expect(updated?.version).toBe(2);
    expect(updated?.GSI8PK).toBeUndefined();
    expect(updated?.GSI8SK).toBeUndefined();
  });

  it("never touches a SATISFIED Requirement whose evidenceValidUntil is still in the future - the GSI8 query's own GSI8SK < before filter excludes it", async () => {
    const requirement = makeSatisfiedRequirement({ evidenceValidUntil: "2026-12-31T00:00:00.000Z" });
    const store = new InMemoryDocumentArchiveStore(seed(requirement));

    const result = await runRequirementReindex({ store, candidates: fakeCandidateSource(store), tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 0, transitioned: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, oldestCandidateAgeSeconds: undefined });
  });

  it("never has a GSI8 pointer at all for a SATISFIED Requirement with no evidenceValidUntil (never expires, never a candidate)", async () => {
    const requirement = makeSatisfiedRequirement({ evidenceValidUntil: undefined });
    const store = new InMemoryDocumentArchiveStore(seed(requirement));
    expect((requirement as Requirement & { GSI8PK?: string }).GSI8PK).toBeUndefined();

    const result = await runRequirementReindex({ store, candidates: fakeCandidateSource(store), tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 0, transitioned: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, oldestCandidateAgeSeconds: undefined });
  });

  it("ignores MISSING/PENDING/NOT_SATISFIED/NOT_APPLICABLE Requirements entirely (none of them ever carry a GSI8 pointer)", async () => {
    const store = new InMemoryDocumentArchiveStore([
      { ...requirementKey(TENANT, SUBJECT, "req-missing"), entityType: "Requirement", requirementId: "req-missing", tenantId: TENANT, subjectId: SUBJECT, name: "x", applicability: "APPLICABLE", status: "MISSING", createdAt: NOW, updatedAt: NOW, version: 1, ...requirementGsi1Keys(TENANT, "MISSING", NOW, "req-missing") },
    ]);
    const result = await runRequirementReindex({ store, candidates: fakeCandidateSource(store), tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 0, transitioned: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, oldestCandidateAgeSeconds: undefined });
  });

  it("processes multiple SATISFIED Requirements across tenants in one run", async () => {
    const r1 = makeSatisfiedRequirement({ requirementId: "req-1", tenantId: "tenant-a" });
    const r2 = makeSatisfiedRequirement({ requirementId: "req-2", tenantId: "tenant-b" });
    const store = new InMemoryDocumentArchiveStore(seed(r1, r2));

    const result = await runRequirementReindex({ store, candidates: fakeCandidateSource(store), tableName: TABLE, now: () => NOW });
    expect(result.scanned).toBe(2);
    expect(result.transitioned).toBe(2);
  });

  it("skips (never throws) a Requirement that was concurrently modified since the GSI8 query observed it", async () => {
    const requirement = makeSatisfiedRequirement();
    const store = new InMemoryDocumentArchiveStore(seed(requirement));
    // Simulate a concurrent write bumping the version between the query and this worker's own
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

    const result = await runRequirementReindex({ store, candidates: fakeCandidateSource(store), tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 1, transitioned: 0, skippedConcurrentlyModified: 1, skippedNotDue: 0, oldestCandidateAgeSeconds: expect.any(Number) });
  });

  it("skips a candidate whose evidenceValidUntil was pushed forward by a concurrent linkEvidence between the query and this worker's fresh read", async () => {
    const requirement = makeSatisfiedRequirement();
    const store = new InMemoryDocumentArchiveStore(seed(requirement));

    // Concurrent winner: a real linkEvidence call re-links fresher evidence, moving validUntil
    // into the future and rewriting the GSI8 pointer atomically, before this worker's own read.
    const nextValidUntil = "2027-01-01T00:00:00.000Z";
    const relink = buildVersionedUpdate({
      tableName: TABLE,
      key: requirementKey(TENANT, SUBJECT, requirement.requirementId),
      tenantId: TENANT,
      expectedVersion: requirement.version,
      set: { evidenceValidUntil: nextValidUntil, ...requirementGsi8Keys({ dueAtIso: nextValidUntil, tenantId: TENANT, requirementId: requirement.requirementId }) },
    });
    await store.transactWrite([{ Update: relink }]);

    // A real GSI8 Query is eventually consistent - it can still return the ORIGINAL (past) sort
    // key for a short window after this write lands, which is exactly the race this worker's own
    // fresh `store.get()` re-read must catch. The live-reading `fakeCandidateSource` above cannot
    // reproduce that lag (it always sees current truth), so this candidate source is pinned to
    // the stale pre-relink pointer directly instead.
    const staleCandidates: RequirementReindexCandidateSource = {
      async queryDue() {
        return { items: [{ PK: requirement.PK, SK: requirement.SK, dueAtIso: requirement.evidenceValidUntil!, tenantId: TENANT, subjectId: SUBJECT, requirementId: requirement.requirementId }] };
      },
    };

    const result = await runRequirementReindex({ store, candidates: staleCandidates, tableName: TABLE, now: () => NOW });
    expect(result).toEqual({ scanned: 1, transitioned: 0, skippedConcurrentlyModified: 0, skippedNotDue: 1, oldestCandidateAgeSeconds: expect.any(Number) });
    const updated = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirement.requirementId));
    expect(updated?.status).toBe("SATISFIED"); // never clobbered by the stale candidate.
  });
});
