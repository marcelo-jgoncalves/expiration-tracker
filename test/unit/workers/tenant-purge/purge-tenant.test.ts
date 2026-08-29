import { describe, expect, it } from "vitest";
import { purgeTenant, TenantPurgeTargetMismatchError, type TenantPurgeDeps } from "../../../../src/workers/tenant-purge/purge-tenant.js";
import type { TenantPurgeCandidateSource, TenantScanItem } from "../../../../src/workers/tenant-purge/dynamo-tenant-purge.js";
import type { SessionTablePurgeSource, SessionTableScanItem } from "../../../../src/workers/tenant-purge/session-table-tenant-purge.js";
import type { S3PurgeSource, S3VersionEntry } from "../../../../src/workers/tenant-purge/s3-tenant-purge.js";
import { InMemoryIdentityStore } from "../../identity/in-memory-store.js";

function dynamoItem(tenantId: string, id: string): TenantScanItem {
  return { PK: `TENANT#${tenantId}#ITEM#${id}`, SK: "ITEM", entityType: "ExpirationItem", tenantId, version: 1 };
}

// B2's added final verification pass calls scanTenantItems AGAIN after the purge loop, so this
// fake must actually reflect deletions against `store` — a fake that just filters a static array
// (disconnected from the store PURGE_DELETE actually writes to) would make every successful
// purge look like it left data behind on re-scan.
function makeDynamoSource(items: TenantScanItem[], store: InMemoryIdentityStore): TenantPurgeCandidateSource {
  return {
    async scanTenantItems(tenantId: string) {
      return { items: items.filter((i) => i.tenantId === tenantId && store.hasRaw({ PK: i.PK, SK: i.SK })) };
    },
  };
}

function makeSessionSource(items: SessionTableScanItem[]): SessionTablePurgeSource & { has(pk: string): boolean } {
  const map = new Map(items.map((i) => [i.PK, i]));
  return {
    async scanTenantSessions(tenantId: string) {
      return { items: [...map.values()].filter((i) => i.tenantId === tenantId) };
    },
    async deleteSession(key, expectedTenantId) {
      const current = map.get(key.PK);
      if (current && current.tenantId !== expectedTenantId) return { deleted: false };
      map.delete(key.PK);
      return { deleted: true };
    },
    has(pk: string) {
      return map.has(pk);
    },
  };
}

function makeS3Source(versions: S3VersionEntry[], opts: { failAlways?: Set<string> } = {}): S3PurgeSource & { versions: S3VersionEntry[] } {
  let live = versions;
  return {
    get versions() {
      return live;
    },
    async listObjectVersions(_bucket, prefix) {
      const matching = live.filter((v) => v.key.startsWith(prefix));
      return { versions: matching, isTruncated: false };
    },
    async deleteObjects(_bucket, entries) {
      const errors: Array<{ key: string; versionId?: string; code: string; message: string }> = [];
      let deletedCount = 0;
      for (const entry of entries) {
        const k = `${entry.key}#${entry.versionId}`;
        if (opts.failAlways?.has(k)) {
          errors.push({ key: entry.key, versionId: entry.versionId, code: "InternalError", message: "boom" });
          continue;
        }
        live = live.filter((v) => !(v.key === entry.key && v.versionId === entry.versionId));
        deletedCount += 1;
      }
      return { deletedCount, errors };
    },
    async listMultipartUploads() {
      return { uploads: [], isTruncated: false };
    },
    async abortMultipartUpload() {},
  };
}

function baseDeps(overrides: Partial<TenantPurgeDeps> = {}): TenantPurgeDeps {
  const store = new InMemoryIdentityStore();
  return {
    dynamo: { store, candidates: makeDynamoSource([], store), tableName: "MainTable" },
    sessionTable: { source: makeSessionSource([]) },
    s3Source: makeS3Source([]),
    s3Targets: [],
    ...overrides,
  };
}

describe("purgeTenant (composable entry point)", () => {
  it("runs every sub-purge and reports SUCCESS when everything converges", async () => {
    const store = new InMemoryIdentityStore();
    const items = [dynamoItem("t1", "a"), dynamoItem("t1", "b")];
    for (const i of items) store.seedRaw(i);
    const sessionSource = makeSessionSource([{ PK: "SESSION#s1", SK: "POINTER", tenantId: "t1" }]);
    const s3Source = makeS3Source([{ key: "tenant/t1/doc-1", versionId: "v1", isDeleteMarker: false }]);

    const result = await purgeTenant(
      {
        dynamo: { store, candidates: makeDynamoSource(items, store), tableName: "MainTable" },
        sessionTable: { source: sessionSource },
        s3Source,
        s3Targets: [{ bucket: "quarantine", prefix: "tenant/t1/", tenantId: "t1" }],
      },
      { tenantId: "t1" },
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.dynamo?.itemsPurged).toBe(2);
    expect(result.sessionTable?.sessionsPurged).toBe(1);
    expect(result.s3).toHaveLength(1);
    expect(result.s3[0]?.versionsDeleted).toBe(1);
    expect(result.checkpoint).toBeUndefined();
    expect(result.failure).toBeUndefined();
  });

  it("reports PARTIAL, never SUCCESS, when an S3 prefix has unresolved DeleteObjects errors — and returns a checkpoint for resume", async () => {
    const s3Source = makeS3Source([{ key: "tenant/t1/doc-1", versionId: "v1", isDeleteMarker: false }], { failAlways: new Set(["tenant/t1/doc-1#v1"]) });

    const result = await purgeTenant(
      baseDeps({ s3Source, s3Targets: [{ bucket: "quarantine", prefix: "tenant/t1/", tenantId: "t1" }] }),
      { tenantId: "t1" },
    );

    expect(result.status).toBe("PARTIAL");
    expect(result.checkpoint).toBeDefined();
    expect(result.s3[0]?.unresolvedErrors).toHaveLength(1);
  });

  it("reports FAILED (not PARTIAL, not SUCCESS) when a sub-purge throws an unexpected error, and still returns whatever partial results were already gathered", async () => {
    const brokenDynamo: TenantPurgeCandidateSource = {
      async scanTenantItems() {
        throw new Error("DynamoDB is unavailable");
      },
    };

    const result = await purgeTenant(baseDeps({ dynamo: { store: new InMemoryIdentityStore(), candidates: brokenDynamo, tableName: "MainTable" } }), { tenantId: "t1" });

    expect(result.status).toBe("FAILED");
    expect(result.failure?.stage).toBe("DYNAMO");
  });

  it("resume: a checkpoint marking dynamo/session-table already done skips the purge loop (only the B2 empty-verification re-scan runs once), only re-attempting S3", async () => {
    let dynamoCalls = 0;
    const dynamoSource: TenantPurgeCandidateSource = {
      async scanTenantItems() {
        dynamoCalls += 1;
        return { items: [] };
      },
    };
    let sessionCalls = 0;
    const sessionSource: SessionTablePurgeSource = {
      async scanTenantSessions() {
        sessionCalls += 1;
        return { items: [] };
      },
      async deleteSession() {
        return { deleted: true };
      },
    };
    const s3Source = makeS3Source([{ key: "tenant/t1/doc-1", versionId: "v1", isDeleteMarker: false }]);

    const result = await purgeTenant(
      {
        dynamo: { store: new InMemoryIdentityStore(), candidates: dynamoSource, tableName: "MainTable" },
        sessionTable: { source: sessionSource },
        s3Source,
        s3Targets: [{ bucket: "quarantine", prefix: "tenant/t1/", tenantId: "t1" }],
      },
      { tenantId: "t1", startFrom: { dynamoDone: true, sessionTableDone: true } },
    );

    // The purge LOOP itself is skipped via the checkpoint (no page-by-page deletion re-attempt),
    // but B2's unconditional final verification still performs exactly one empty re-scan of each
    // store before trusting SUCCESS — this is the whole point of the fix, not a regression.
    expect(dynamoCalls).toBe(1);
    expect(sessionCalls).toBe(1);
    expect(result.status).toBe("SUCCESS");
    expect(result.s3[0]?.versionsDeleted).toBe(1);
  });

  it("idempotent as a whole: re-running against an already-fully-purged tenant is a clean SUCCESS no-op, never an error", async () => {
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "tenant/t1/", tenantId: "t1" }] });
    const first = await purgeTenant(deps, { tenantId: "t1" });
    expect(first.status).toBe("SUCCESS");
    const second = await purgeTenant(deps, { tenantId: "t1" });
    expect(second.status).toBe("SUCCESS");
    expect(second.dynamo?.itemsPurged).toBe(0);
    expect(second.sessionTable?.sessionsPurged).toBe(0);
    expect(second.s3[0]?.versionsDeleted).toBe(0);
  });

  it("B4 fix: a nonzero itemsRejectedBySafetyCondition on the dynamo sub-purge forces PARTIAL, never SUCCESS", async () => {
    const store = new InMemoryIdentityStore();
    // A scan/filter bug hands back a row belonging to a DIFFERENT tenant than the one being
    // purged — PURGE_DELETE's safety condition rejects it (SystemMutationConflictError), which
    // dynamo-tenant-purge.ts counts but previously purge-tenant.ts silently ignored.
    const foreignItem: TenantScanItem = { PK: "TENANT#other-tenant#ITEM#x", SK: "ITEM", entityType: "ExpirationItem", tenantId: "other-tenant", version: 1 };
    // Must actually EXIST in the store for the safety condition to genuinely fail — an
    // attribute_not_exists(PK) match (never-existed key) is the idempotent no-op path, not a
    // rejection, so this test would falsely "pass" purge for an unseeded row.
    store.seedRaw(foreignItem);
    const brokenDynamoSource: TenantPurgeCandidateSource = {
      async scanTenantItems() {
        return { items: [foreignItem] };
      },
    };

    const result = await purgeTenant(
      baseDeps({ dynamo: { store, candidates: brokenDynamoSource, tableName: "MainTable" } }),
      { tenantId: "t1" },
    );

    expect(result.status).toBe("PARTIAL");
    expect(result.dynamo?.itemsRejectedBySafetyCondition).toBe(1);
  });

  it("B6 fix: an S3 target claiming a different tenant than the one being purged is rejected loudly (never silently purges the wrong tenant)", async () => {
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "tenant/tenant-b/", tenantId: "tenant-b" }] });

    await expect(purgeTenant(deps, { tenantId: "tenant-a" })).rejects.toThrow(/tenantId "tenant-b"/);
  });

  it("B6 residual (Codex round 2 finding): a target whose tenantId label matches but whose prefix actually belongs to a different tenant is rejected loudly, not silently purged", async () => {
    // The exact bypass the first B6 fix missed: target.tenantId is mislabeled to match
    // input.tenantId, but the prefix itself is a real different tenant's namespace — the old
    // check (label-vs-label only) would have let this straight through and physically deleted
    // tenant-b's objects while purging tenant-a.
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "tenant/tenant-b/", tenantId: "tenant-a" }] });

    await expect(purgeTenant(deps, { tenantId: "tenant-a" })).rejects.toThrow(/tenantId "tenant-a"/);
  });

  it("B6 residual: a substring collision between tenant ids (e.g. \"12\" vs \"123\") is not accepted as a match", async () => {
    // prefixBelongsToTenant must treat the tenantId as a full path segment, not a substring —
    // otherwise purging tenant "12" would accept a prefix that actually belongs to tenant "123".
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "tenant/123/doc-1", tenantId: "12" }] });

    await expect(purgeTenant(deps, { tenantId: "12" })).rejects.toThrow(/tenantId "12"/);
  });

  it("B6 residual (Codex round 3 finding): a prefix ending in the tenantId with no trailing slash is rejected, because S3 matches by raw byte prefix, not path segment", async () => {
    // "tenant/tenant-a" (no trailing "/") would have passed the round-2 fix's `(^|/)...(/|$)`
    // check, but a real S3 ListObjectVersions/DeleteObjects with Prefix="tenant/tenant-a" also
    // matches "tenant/tenant-a2/..." and "tenant/tenant-a-b/..." — a different tenant's objects,
    // deleted only because their key happens to start with the same bytes.
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "tenant/tenant-a", tenantId: "tenant-a" }] });

    await expect(purgeTenant(deps, { tenantId: "tenant-a" })).rejects.toThrow(/tenantId "tenant-a"/);
  });

  it("B6 residual (Codex round 4 finding): a prefix genuinely rooted under a DIFFERENT tenant's namespace, which merely contains the purged tenantId as a later segment, is rejected", async () => {
    // The exact bypass round-3's fix (trailing-slash requirement) still missed: "tenantId appears
    // as a /-delimited segment ANYWHERE in prefix" also matched a prefix rooted under tenant-b,
    // with tenant-a appearing deeper in the path — purging tenant-a would have physically deleted
    // tenant-b's objects. Only a match ANCHORED at the start of prefix (one of the real
    // TENANT_PREFIX_ROOTS) is safe.
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "tenant/tenant-b/item/tenant-a/", tenantId: "tenant-a" }] });

    await expect(purgeTenant(deps, { tenantId: "tenant-a" })).rejects.toThrow(/tenantId "tenant-a"/);
  });

  it("B6 residual (Codex round 3 finding): an empty tenantId is never accepted as bound to any prefix", async () => {
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "anything/", tenantId: "" }] });

    await expect(purgeTenant(deps, { tenantId: "" })).rejects.toThrow(TenantPurgeTargetMismatchError);
  });

  it("B6: a legitimate target rooted under each of the three real prefix conventions (clean/, tenant/, ocr/) is accepted", async () => {
    for (const prefix of ["clean/t1/", "tenant/t1/", "ocr/t1/"]) {
      const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix, tenantId: "t1" }] });
      const result = await purgeTenant(deps, { tenantId: "t1" });
      expect(result.status).toBe("SUCCESS");
    }
  });

  it("B2 fix: a stale checkpoint claiming dynamo/session already done does not mask leftover data — the unconditional final verification catches it and forces PARTIAL", async () => {
    // Simulate a resumed run where the checkpoint says the dynamo phase is done, but a re-scan
    // (the purge loop itself is skipped) still finds a real leftover row — this is exactly the
    // "one traversal happened to look complete, but nothing re-checked afterward" scenario the
    // approved design's "re-scan vazio" requirement exists to catch.
    const leftover: TenantScanItem = { PK: "TENANT#t1#ITEM#leftover", SK: "ITEM", entityType: "ExpirationItem", tenantId: "t1", version: 1 };
    const staleDynamoSource: TenantPurgeCandidateSource = {
      async scanTenantItems() {
        return { items: [leftover] };
      },
    };

    const result = await purgeTenant(
      baseDeps({ dynamo: { store: new InMemoryIdentityStore(), candidates: staleDynamoSource, tableName: "MainTable" } }),
      { tenantId: "t1", startFrom: { dynamoDone: true, sessionTableDone: true } },
    );

    expect(result.status).toBe("PARTIAL");
  });

  it("invokes onCheckpoint as sub-purges progress, not only at the very end", async () => {
    const store = new InMemoryIdentityStore();
    const items = [dynamoItem("t1", "a")];
    for (const i of items) store.seedRaw(i);
    const checkpoints: unknown[] = [];

    await purgeTenant(
      {
        dynamo: { store, candidates: makeDynamoSource(items, store), tableName: "MainTable" },
        sessionTable: { source: makeSessionSource([]) },
        s3Source: makeS3Source([]),
        s3Targets: [],
        onCheckpoint: async (cp) => void checkpoints.push(cp),
      },
      { tenantId: "t1" },
    );

    expect(checkpoints.length).toBeGreaterThan(0);
  });
});
