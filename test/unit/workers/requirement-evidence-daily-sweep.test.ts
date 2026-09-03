import { describe, expect, it } from "vitest";
import { runRequirementEvidenceDailySweep, type RequirementEvidenceDailySweepHint } from "../../../src/workers/requirement-evidence-daily-sweep/sweep.js";
import { InMemoryDocumentArchiveStore } from "../document-archive/in-memory-store.js";
import { requirementGsi1Keys, requirementGsi8Keys, requirementGsi9Keys, requirementKey, type Requirement, type RequirementStatus } from "../../../src/modules/document-archive/domain/requirement.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";
import type { DocumentArchiveStore, ScanPage } from "../../../src/modules/document-archive/ports/document-archive-store.js";

const TENANT = "tenant-1";
const SUBJECT = "subject-1";
const DOCUMENT_ID = "doc-1";

function seed(...items: Requirement[]): (Record<string, unknown> & EntityKey)[] {
  return items as unknown as (Record<string, unknown> & EntityKey)[];
}

function makeRequirement(overrides: Partial<Requirement> & { requirementId: string }): Requirement {
  const tenantId = overrides.tenantId ?? TENANT;
  const status: RequirementStatus = overrides.status ?? "SATISFIED";
  const base: Requirement = {
    ...requirementKey(tenantId, SUBJECT, overrides.requirementId),
    entityType: "Requirement",
    requirementId: overrides.requirementId,
    tenantId,
    subjectId: SUBJECT,
    name: "CND Federal",
    applicability: "APPLICABLE",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...requirementGsi1Keys(tenantId, status, "2026-01-01T00:00:00.000Z", overrides.requirementId),
  } as Requirement;
  return { ...base, ...overrides } as Requirement;
}

function makeLinkedRequirement(overrides: Partial<Requirement> & { requirementId: string; versionId: string }): Requirement {
  const tenantId = overrides.tenantId ?? TENANT;
  const evidenceValidUntil = overrides.evidenceValidUntil ?? "2026-08-01T00:00:00.000Z";
  return makeRequirement({
    evidenceVersionId: overrides.versionId,
    evidenceDocumentId: DOCUMENT_ID,
    evidenceSeq: 1,
    evidenceState: "ACCEPTED",
    evidenceValidUntil,
    ...requirementGsi8Keys({ dueAtIso: evidenceValidUntil, tenantId, requirementId: overrides.requirementId }),
    ...requirementGsi9Keys({ tenantId, evidenceVersionId: overrides.versionId, requirementId: overrides.requirementId }),
    ...overrides,
  });
}

function makeEnqueueSpy() {
  const calls: { hint: RequirementEvidenceDailySweepHint; correlationId: string }[] = [];
  const enqueueRefresh = async (hint: RequirementEvidenceDailySweepHint, correlationId: string) => {
    calls.push({ hint, correlationId });
  };
  return { calls, enqueueRefresh };
}

let correlationCounter = 0;
function newCorrelationId(): string {
  correlationCounter += 1;
  return `corr-${correlationCounter}`;
}

describe("runRequirementEvidenceDailySweep (D-193 item 7/9: authoritative repair net, never trusts an event ever arriving)", () => {
  it("finds a Requirement with linked evidence regardless of its current cached status (ACTIVE/SATISFIED/PENDING/NOT_SATISFIED) — status-independent by design", async () => {
    const statuses: RequirementStatus[] = ["SATISFIED", "PENDING", "NOT_SATISFIED"];
    const requirements = statuses.map((status, i) => makeLinkedRequirement({ requirementId: `req-${i}`, versionId: `ver-${i}`, status }));
    const store = new InMemoryDocumentArchiveStore(seed(...requirements));
    const { calls, enqueueRefresh } = makeEnqueueSpy();

    const result = await runRequirementEvidenceDailySweep({ store, enqueueRefresh, newCorrelationId });

    expect(result).toEqual({ scanned: 3, enqueued: 3, skippedNoEvidence: 0 });
    const enqueuedVersionIds = calls.map((c) => c.hint.versionId).sort();
    expect(enqueuedVersionIds).toEqual(["ver-0", "ver-1", "ver-2"]);
    for (const call of calls) {
      expect(call.hint.tenantId).toBe(TENANT);
    }
  });

  it("skips a Requirement with no evidence link at all — the sparse evidenceVersionId field is genuinely absent, never a falsy placeholder", async () => {
    const linked = makeLinkedRequirement({ requirementId: "req-linked", versionId: "ver-1" });
    const unlinked = makeRequirement({ requirementId: "req-unlinked", status: "MISSING" });
    expect("evidenceVersionId" in unlinked).toBe(false);
    const store = new InMemoryDocumentArchiveStore(seed(linked, unlinked));
    const { calls, enqueueRefresh } = makeEnqueueSpy();

    const result = await runRequirementEvidenceDailySweep({ store, enqueueRefresh, newCorrelationId });

    expect(result).toEqual({ scanned: 1, enqueued: 1, skippedNoEvidence: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.hint).toEqual({ tenantId: TENANT, versionId: "ver-1" });
  });

  it("pages through multiple Scan pages until lastEvaluatedKey is absent, enqueueing every candidate across all pages", async () => {
    // Isolated pagination fake — three pages of one candidate each, independent of the
    // InMemoryDocumentArchiveStore's single-page fake (which has no pagination behavior to test).
    const pages: ScanPage<Requirement>[] = [
      { items: [makeLinkedRequirement({ requirementId: "req-0", versionId: "ver-0" })], lastEvaluatedKey: { PK: "p0" } },
      { items: [makeLinkedRequirement({ requirementId: "req-1", versionId: "ver-1" })], lastEvaluatedKey: { PK: "p1" } },
      { items: [makeLinkedRequirement({ requirementId: "req-2", versionId: "ver-2" })], lastEvaluatedKey: undefined },
    ];
    let callIndex = 0;
    const receivedStartKeys: (Record<string, unknown> | undefined)[] = [];
    const pagingStore: Pick<DocumentArchiveStore, "scanRequirementsWithEvidence"> = {
      async scanRequirementsWithEvidence<T extends EntityKey = Record<string, unknown> & EntityKey>(exclusiveStartKey?: Record<string, unknown>) {
        receivedStartKeys.push(exclusiveStartKey);
        const page = pages[callIndex];
        callIndex += 1;
        if (!page) throw new Error("pagingStore: no more pages configured — sweep called scanRequirementsWithEvidence too many times");
        return page as unknown as ScanPage<T>;
      },
    };
    const { calls, enqueueRefresh } = makeEnqueueSpy();

    const result = await runRequirementEvidenceDailySweep({ store: pagingStore, enqueueRefresh, newCorrelationId });

    expect(result).toEqual({ scanned: 3, enqueued: 3, skippedNoEvidence: 0 });
    expect(callIndex).toBe(3);
    expect(receivedStartKeys).toEqual([undefined, { PK: "p0" }, { PK: "p1" }]);
    expect(calls.map((c) => c.hint.versionId)).toEqual(["ver-0", "ver-1", "ver-2"]);
  });

  it("re-enqueues a Requirement whose evidence changed but whose SQS_REQUIREMENT_EVIDENCE_REFRESH_V1 wake-up was totally lost — the exact total-message-loss scenario item 6/9 left open", async () => {
    // The Requirement's cached evidenceValidUntil/status is stale relative to what a real
    // DocumentVersion confirm would have produced — this worker never looks at that, only at
    // whether evidenceVersionId is present, so it re-pokes the SAME candidate slice 6's
    // refresh.ts would have processed had the original outbox message not been lost entirely.
    const staleRequirement = makeLinkedRequirement({
      requirementId: "req-stale",
      versionId: "ver-stale",
      status: "SATISFIED", // stale cache — the real DocumentVersion may have since expired/been rejected.
      evidenceValidUntil: "2020-01-01T00:00:00.000Z", // long past — a live refresh would flip this to NOT_SATISFIED.
    });
    const store = new InMemoryDocumentArchiveStore(seed(staleRequirement));
    const { calls, enqueueRefresh } = makeEnqueueSpy();

    const result = await runRequirementEvidenceDailySweep({ store, enqueueRefresh, newCorrelationId });

    // The sweep itself never re-derives status (that's refresh.ts's job) — it only proves the
    // wake-up gets re-sent with the correct discovery pair, which is what lets refresh.ts
    // converge this Requirement once the message actually arrives this time.
    expect(result).toEqual({ scanned: 1, enqueued: 1, skippedNoEvidence: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.hint).toEqual({ tenantId: TENANT, versionId: "ver-stale" });
    expect(calls[0]?.correlationId).toBeTruthy();
  });

  it("an empty scan (no Requirements with evidence at all) is a clean no-op result", async () => {
    const store = new InMemoryDocumentArchiveStore([]);
    const { calls, enqueueRefresh } = makeEnqueueSpy();

    const result = await runRequirementEvidenceDailySweep({ store, enqueueRefresh, newCorrelationId });

    expect(result).toEqual({ scanned: 0, enqueued: 0, skippedNoEvidence: 0 });
    expect(calls).toHaveLength(0);
  });
});
