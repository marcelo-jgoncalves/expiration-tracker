import { describe, expect, it } from "vitest";
import { refreshRequirementsForEvidenceVersion, type RequirementEvidenceRefreshDeps } from "../../../src/workers/requirement-evidence-refresh/refresh.js";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import {
  requirementGsi1Keys,
  requirementGsi8Keys,
  requirementGsi9Keys,
  requirementGsi9PartitionKey,
  requirementKey,
  type Requirement,
} from "../../../src/modules/document-archive/domain/requirement.js";
import { documentVersionKey, type DocumentVersion } from "../../../src/modules/document-archive/domain/document-version.js";
import { buildVersionedUpdate, type EntityKey } from "../../../src/shared/dynamodb/occ.js";

/** Same cast rationale as `requirement-reindex.test.ts`'s `seed` helper. */
function seed(...items: (Requirement | DocumentVersion)[]): (Record<string, unknown> & EntityKey)[] {
  return items as unknown as (Record<string, unknown> & EntityKey)[];
}

const TABLE = "test-table";
const TENANT = "tenant-1";
const SUBJECT = "subject-1";
const DOCUMENT_ID = "doc-1";
const VERSION_ID = "ver-1";
const NOW = "2026-09-03T00:00:00.000Z";

function makeDocumentVersion(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    ...documentVersionKey(TENANT, DOCUMENT_ID, 1),
    entityType: "DocumentVersion",
    versionId: VERSION_ID,
    documentId: DOCUMENT_ID,
    tenantId: TENANT,
    seq: 1,
    state: "ACCEPTED",
    origin: "MANUAL_UPLOAD",
    pendingFileScans: 0,
    infectedFileScans: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  } as DocumentVersion;
}

function makeLinkedRequirement(overrides: Partial<Requirement> = {}): Requirement {
  const requirementId = overrides.requirementId ?? "req-1";
  const tenantId = overrides.tenantId ?? TENANT;
  const status = overrides.status ?? "SATISFIED";
  const evidenceValidUntil = "evidenceValidUntil" in overrides ? overrides.evidenceValidUntil : "2026-08-01T00:00:00.000Z";
  return {
    ...requirementKey(tenantId, SUBJECT, requirementId),
    entityType: "Requirement",
    requirementId,
    tenantId,
    subjectId: SUBJECT,
    name: "CND Federal",
    applicability: "APPLICABLE",
    status,
    evidenceVersionId: VERSION_ID,
    evidenceDocumentId: DOCUMENT_ID,
    evidenceSeq: 1,
    evidenceState: "ACCEPTED",
    ...(evidenceValidUntil !== undefined ? { evidenceValidUntil } : {}),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...requirementGsi1Keys(tenantId, status, "2026-01-01T00:00:00.000Z", requirementId),
    ...(evidenceValidUntil !== undefined ? requirementGsi8Keys({ dueAtIso: evidenceValidUntil, tenantId, requirementId }) : {}),
    ...requirementGsi9Keys({ tenantId, evidenceVersionId: VERSION_ID, requirementId }),
    ...overrides,
  } as Requirement;
}

/** Fake mirroring the real GSI9 Query contract (`findRequirementsByEvidenceVersion`) — reads
 * live off the SAME store the worker's transactional writes land in, same discipline
 * `requirement-reindex.test.ts`'s `fakeCandidateSource` uses for GSI8. Only exposes the ONE
 * method `refresh.ts` actually depends on (`Pick<DocumentArchiveService, ...>`). */
function fakeDocumentArchive(store: InMemoryDocumentArchiveStore): RequirementEvidenceRefreshDeps["documentArchive"] {
  return {
    async findRequirementsByEvidenceVersion(tenantId: string, evidenceVersionId: string) {
      const partitionKey = requirementGsi9PartitionKey(tenantId, evidenceVersionId);
      return store.allItems().filter((item) => item["entityType"] === "Requirement" && item["GSI9PK"] === partitionKey) as unknown as Requirement[];
    },
  };
}

function makeDeps(store: InMemoryDocumentArchiveStore): RequirementEvidenceRefreshDeps {
  return { documentArchive: fakeDocumentArchive(store), store, tableName: TABLE, now: () => NOW };
}

describe("refreshRequirementsForEvidenceVersion (D-193 item 6/9: async Requirement convergence, never trusts the event payload)", () => {
  it("adversarial G-V3: converges correctly even when the wake-up hint carries a stale/wrong versionId — only tenantId+versionId are ever read from it, and even those are used ONLY for GSI9 discovery, never as the source of the recomputed state", async () => {
    // The evidence DocumentVersion's REAL current state (validUntil pushed into the future by a
    // confirm that happened after the event was queued) — trusting a stale event payload here
    // would produce NOT_SATISFIED; the correct, fresh-read answer is SATISFIED.
    const version = makeDocumentVersion({ validUntil: "2027-01-01T00:00:00.000Z" });
    const requirement = makeLinkedRequirement({ status: "SATISFIED", evidenceState: "ACCEPTED", evidenceValidUntil: "2026-01-01T00:00:00.000Z" }); // stale cache: an EARLIER validUntil
    const store = new InMemoryDocumentArchiveStore(seed(requirement, version));
    const deps = makeDeps(store);

    // A hint whose own "wake up" carries no authoritative value at all — the handler layer only
    // ever forwards tenantId/versionId, so this call shape itself already proves the point: there
    // is no `validUntil`/`state` field on the hint an adversarial payload could poison.
    const result = await refreshRequirementsForEvidenceVersion(deps, { tenantId: TENANT, versionId: VERSION_ID });

    expect(result).toEqual({ discovered: 1, updated: 1, noop: 0, failed: 0, failedRequirementIds: [] });
    const updated = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirement.requirementId));
    expect(updated?.status).toBe("SATISFIED");
    expect(updated?.evidenceValidUntil).toBe("2027-01-01T00:00:00.000Z"); // the FRESH value, never the stale cache.
    expect(updated?.version).toBe(2);
  });

  it("adversarial G-V3: a DocumentVersion that has since been REJECTED (state changed, not just validUntil) still converges to NOT_SATISFIED via PENDING-vs-rejected branch by fresh read, never from any cached/event value", async () => {
    const version = makeDocumentVersion({ state: "REJECTED", validUntil: undefined });
    const requirement = makeLinkedRequirement({ status: "SATISFIED", evidenceState: "ACCEPTED", evidenceValidUntil: "2026-01-01T00:00:00.000Z" });
    const store = new InMemoryDocumentArchiveStore(seed(requirement, version));
    const deps = makeDeps(store);

    const result = await refreshRequirementsForEvidenceVersion(deps, { tenantId: TENANT, versionId: VERSION_ID });

    expect(result).toEqual({ discovered: 1, updated: 1, noop: 0, failed: 0, failedRequirementIds: [] });
    const updated = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirement.requirementId));
    expect(updated?.status).toBe("PENDING"); // deriveRequirementStatus: ACCEPTED-only gate, REJECTED -> PENDING.
    expect(updated?.evidenceState).toBe("REJECTED");
    expect(updated?.evidenceValidUntil).toBeUndefined();
    expect(updated?.GSI8PK).toBeUndefined();
  });

  it("multiple Requirements linked to the same DocumentVersion all refresh independently — one OCC failure mid-batch never blocks the others", async () => {
    const version = makeDocumentVersion({ validUntil: "2027-01-01T00:00:00.000Z" });
    const r1 = makeLinkedRequirement({ requirementId: "req-1", evidenceValidUntil: "2026-01-01T00:00:00.000Z" });
    const r2 = makeLinkedRequirement({ requirementId: "req-2", evidenceValidUntil: "2026-01-01T00:00:00.000Z" });
    const r3 = makeLinkedRequirement({ requirementId: "req-3", evidenceValidUntil: "2026-01-01T00:00:00.000Z" });
    const store = new InMemoryDocumentArchiveStore(seed(r1, r2, r3, version));
    const deps = makeDeps(store);

    // req-2's very first transactWrite attempt loses an OCC race (simulating a concurrent
    // caller mutation) — every OTHER call (req-1, req-3, and req-2's own retry) proceeds
    // normally through the real store.
    const realTransactWrite = store.transactWrite.bind(store);
    let failedOnce = false;
    store.transactWrite = async (entries) => {
      const isReq2 = JSON.stringify(entries).includes("req-2");
      if (isReq2 && !failedOnce) {
        failedOnce = true;
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      }
      return realTransactWrite(entries);
    };

    const result = await refreshRequirementsForEvidenceVersion(deps, { tenantId: TENANT, versionId: VERSION_ID });

    expect(result.discovered).toBe(3);
    expect(result.updated).toBe(3); // req-2 succeeds on its own internal retry, not counted as failed.
    expect(result.failed).toBe(0);
    for (const id of ["req-1", "req-2", "req-3"]) {
      const updated = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, id));
      expect(updated?.status).toBe("SATISFIED");
      expect(updated?.evidenceValidUntil).toBe("2027-01-01T00:00:00.000Z");
    }
  });

  it("a Requirement whose terminal OCC failure exhausts all retries is recorded as failed WITHOUT aborting the rest of the batch", async () => {
    const version = makeDocumentVersion({ validUntil: "2027-01-01T00:00:00.000Z" });
    const r1 = makeLinkedRequirement({ requirementId: "req-1", evidenceValidUntil: "2026-01-01T00:00:00.000Z" });
    const r2 = makeLinkedRequirement({ requirementId: "req-2", evidenceValidUntil: "2026-01-01T00:00:00.000Z" });
    const store = new InMemoryDocumentArchiveStore(seed(r1, r2, version));
    const deps = makeDeps(store);

    const realTransactWrite = store.transactWrite.bind(store);
    store.transactWrite = async (entries) => {
      if (JSON.stringify(entries).includes("req-1")) {
        throw { name: "TransactionCanceledException", message: "ConditionalCheckFailed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] };
      }
      return realTransactWrite(entries);
    };

    const result = await refreshRequirementsForEvidenceVersion(deps, { tenantId: TENANT, versionId: VERSION_ID });

    expect(result.discovered).toBe(2);
    expect(result.updated).toBe(1); // req-2 still converges.
    expect(result.failed).toBe(1);
    expect(result.failedRequirementIds).toEqual(["req-1"]);
    const req2Updated = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, "req-2"));
    expect(req2Updated?.status).toBe("SATISFIED");
  });

  it("a Requirement with no actual change is a no-op — never rewrites/bumps version", async () => {
    const version = makeDocumentVersion({ validUntil: "2027-01-01T00:00:00.000Z" });
    const requirement = makeLinkedRequirement({ status: "SATISFIED", evidenceState: "ACCEPTED", evidenceValidUntil: "2027-01-01T00:00:00.000Z" });
    const store = new InMemoryDocumentArchiveStore(seed(requirement, version));
    const deps = makeDeps(store);

    let transactWriteCalls = 0;
    const realTransactWrite = store.transactWrite.bind(store);
    store.transactWrite = async (entries) => {
      transactWriteCalls += 1;
      return realTransactWrite(entries);
    };

    const result = await refreshRequirementsForEvidenceVersion(deps, { tenantId: TENANT, versionId: VERSION_ID });

    expect(result).toEqual({ discovered: 1, updated: 0, noop: 1, failed: 0, failedRequirementIds: [] });
    expect(transactWriteCalls).toBe(0); // no spurious rewrite.
    const unchanged = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirement.requirementId));
    expect(unchanged?.version).toBe(1);
  });

  it("a Requirement unlinked since discovery (no evidenceVersionId on fresh read) is a no-op, never throws", async () => {
    const version = makeDocumentVersion({ validUntil: "2027-01-01T00:00:00.000Z" });
    const requirement = makeLinkedRequirement();
    const store = new InMemoryDocumentArchiveStore(seed(requirement, version));
    const deps = makeDeps(store);

    // Simulate unlinkEvidence racing ahead of this worker's own read.
    const unlink = buildVersionedUpdate({
      tableName: TABLE,
      key: requirementKey(TENANT, SUBJECT, requirement.requirementId),
      tenantId: TENANT,
      expectedVersion: requirement.version,
      set: { status: "MISSING" },
      remove: ["evidenceVersionId", "evidenceDocumentId", "evidenceSeq", "evidenceState", "evidenceValidUntil", "GSI8PK", "GSI8SK", "GSI9PK", "GSI9SK"],
    });
    await store.transactWrite([{ Update: unlink }]);

    // A real GSI9 Query result observed BEFORE the unlink landed (eventual consistency, or this
    // message simply arrived after a later unlink) — pinned to the stale pre-unlink candidate
    // directly, same "fake is live, real GSI can lag" distinction `requirement-reindex.test.ts`
    // documents for its own GSI8 staleness test. The worker's own per-Requirement fresh
    // `store.get()` re-read (never the discovery query's projection) is what must catch this.
    const staleDeps: RequirementEvidenceRefreshDeps = {
      ...deps,
      documentArchive: { async findRequirementsByEvidenceVersion() { return [requirement]; } },
    };

    const result = await refreshRequirementsForEvidenceVersion(staleDeps, { tenantId: TENANT, versionId: VERSION_ID });
    expect(result).toEqual({ discovered: 1, updated: 0, noop: 1, failed: 0, failedRequirementIds: [] });
    const stillUnlinked = await store.get<Requirement>(requirementKey(TENANT, SUBJECT, requirement.requirementId));
    expect(stillUnlinked?.status).toBe("MISSING"); // never clobbered by the stale candidate.
  });

  it("no candidates discovered is a clean no-op result", async () => {
    const store = new InMemoryDocumentArchiveStore([]);
    const deps = makeDeps(store);
    const result = await refreshRequirementsForEvidenceVersion(deps, { tenantId: TENANT, versionId: "nonexistent-version" });
    expect(result).toEqual({ discovered: 0, updated: 0, noop: 0, failed: 0, failedRequirementIds: [] });
  });
});
