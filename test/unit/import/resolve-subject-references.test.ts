import { describe, expect, it } from "vitest";
import { InMemorySubjectStore } from "../subject/in-memory-store.js";
import { resolveSubjectReferences } from "../../../src/modules/import/application/resolve-subject-references.js";
import { subjectExternalIdPointerKey, subjectKey, type SubjectExternalIdPointer, type TrackedSubject } from "../../../src/modules/subject/domain/tracked-subject.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

type SeedItem = Record<string, unknown> & EntityKey;

const TENANT = "tenant-1";
const NOW = "2026-09-03T00:00:00.000Z";

function seedSubject(id: string, externalId: string, status: TrackedSubject["status"] = "ACTIVE") {
  const subject: TrackedSubject = {
    ...subjectKey(TENANT, id),
    entityType: "TrackedSubject",
    subjectId: id,
    tenantId: TENANT,
    type: "VENDOR",
    displayName: `Subject ${id}`,
    displayNameNormalized: `subject ${id}`,
    externalId,
    tags: [],
    status,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI7PK: `TENANT#${TENANT}#SUBJECTSTATUS#${status}`,
    GSI7SK: `VENDOR#subject ${id}#${id}`,
  };
  const pointer: SubjectExternalIdPointer = {
    ...subjectExternalIdPointerKey(TENANT, externalId),
    entityType: "SubjectExternalIdPointer",
    tenantId: TENANT,
    externalId,
    subjectId: id,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
  return { subject: subject as unknown as SeedItem, pointer: pointer as unknown as SeedItem };
}

describe("resolveSubjectReferences (D-192 §4, batched two-phase resolution)", () => {
  it("resolves a duplicate externalId reference ONCE across the batch, never double-fetched", async () => {
    const { subject, pointer } = seedSubject("s1", "ext-1");
    const store = new InMemorySubjectStore([pointer, subject]);

    const result = await resolveSubjectReferences(store, TENANT, "EXTERNAL_ID", ["ext-1", "ext-1", "ext-1"]);

    expect(result.get("ext-1")).toEqual({ kind: "RESOLVED", subjectId: "s1" });
    // Phase 1 batchGet call: exactly 1 distinct key requested (deduped before the call, not
    // after) - proves the batch collapsed the 3 duplicate rows into a single lookup.
    // Phase 2 batchGet call: exactly 1 distinct subjectId. Total keys across both calls: 2.
    expect(store.batchGetCallCount).toBe(2);
    expect(store.batchGetKeyCount).toBe(2);
  });

  it("rejects a reference to a nonexistent Subject as NOT_FOUND, never a crash", async () => {
    const store = new InMemorySubjectStore([]);

    const result = await resolveSubjectReferences(store, TENANT, "EXTERNAL_ID", ["ghost"]);

    expect(result.get("ghost")).toEqual({ kind: "NOT_FOUND" });
  });

  it("rejects a reference to an ARCHIVED Subject as NOT_FOUND (mirrors the createDocument/createRequirement fence)", async () => {
    const { subject, pointer } = seedSubject("s2", "ext-2", "ARCHIVED");
    const store = new InMemorySubjectStore([pointer, subject]);

    const result = await resolveSubjectReferences(store, TENANT, "EXTERNAL_ID", ["ext-2"]);

    expect(result.get("ext-2")).toEqual({ kind: "NOT_FOUND" });
  });

  it("rejects a reference to a DELETED Subject as NOT_FOUND", async () => {
    const { subject, pointer } = seedSubject("s3", "ext-3", "DELETED");
    const store = new InMemorySubjectStore([pointer, subject]);

    const result = await resolveSubjectReferences(store, TENANT, "EXTERNAL_ID", ["ext-3"]);

    expect(result.get("ext-3")).toEqual({ kind: "NOT_FOUND" });
  });

  it("resolves SUBJECT_ID-kind references directly against TrackedSubject, skipping the pointer phase entirely", async () => {
    const { subject } = seedSubject("s4", "ext-4");
    const store = new InMemorySubjectStore([subject]);

    const result = await resolveSubjectReferences(store, TENANT, "SUBJECT_ID", ["s4"]);

    expect(result.get("s4")).toEqual({ kind: "RESOLVED", subjectId: "s4" });
    // Only phase 2 runs for SUBJECT_ID-kind references - no pointer lookup at all.
    expect(store.batchGetCallCount).toBe(1);
  });

  it("returns an empty map for an empty batch without calling batchGet", async () => {
    const store = new InMemorySubjectStore([]);

    const result = await resolveSubjectReferences(store, TENANT, "EXTERNAL_ID", []);

    expect(result.size).toBe(0);
    expect(store.batchGetCallCount).toBe(0);
  });

  it("resolves a mixed batch (some found, some not) independently per reference", async () => {
    const { subject: s1, pointer: p1 } = seedSubject("s5", "ext-5");
    const store = new InMemorySubjectStore([p1, s1]);

    const result = await resolveSubjectReferences(store, TENANT, "EXTERNAL_ID", ["ext-5", "ext-missing"]);

    expect(result.get("ext-5")).toEqual({ kind: "RESOLVED", subjectId: "s5" });
    expect(result.get("ext-missing")).toEqual({ kind: "NOT_FOUND" });
  });
});
