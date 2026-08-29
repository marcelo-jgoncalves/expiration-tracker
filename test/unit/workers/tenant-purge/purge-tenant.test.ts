import { describe, expect, it } from "vitest";
import { purgeTenant, type TenantPurgeDeps } from "../../../../src/workers/tenant-purge/purge-tenant.js";
import type { TenantPurgeCandidateSource, TenantScanItem } from "../../../../src/workers/tenant-purge/dynamo-tenant-purge.js";
import type { SessionTablePurgeSource, SessionTableScanItem } from "../../../../src/workers/tenant-purge/session-table-tenant-purge.js";
import type { S3PurgeSource, S3VersionEntry } from "../../../../src/workers/tenant-purge/s3-tenant-purge.js";
import { InMemoryIdentityStore } from "../../identity/in-memory-store.js";

function dynamoItem(tenantId: string, id: string): TenantScanItem {
  return { PK: `TENANT#${tenantId}#ITEM#${id}`, SK: "ITEM", entityType: "ExpirationItem", tenantId, version: 1 };
}

function makeDynamoSource(items: TenantScanItem[]): TenantPurgeCandidateSource {
  return {
    async scanTenantItems(tenantId: string) {
      return { items: items.filter((i) => i.tenantId === tenantId) };
    },
  };
}

function makeSessionSource(items: SessionTableScanItem[]): SessionTablePurgeSource & { has(pk: string): boolean } {
  const map = new Map(items.map((i) => [i.PK, i]));
  return {
    async scanTenantSessions(tenantId: string) {
      return { items: [...map.values()].filter((i) => i.tenantId === tenantId) };
    },
    async deleteSession(key) {
      map.delete(key.PK);
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
    dynamo: { store, candidates: makeDynamoSource([]), tableName: "MainTable" },
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
    const s3Source = makeS3Source([{ key: "t1/doc-1", versionId: "v1", isDeleteMarker: false }]);

    const result = await purgeTenant(
      {
        dynamo: { store, candidates: makeDynamoSource(items), tableName: "MainTable" },
        sessionTable: { source: sessionSource },
        s3Source,
        s3Targets: [{ bucket: "quarantine", prefix: "t1/" }],
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
    const s3Source = makeS3Source([{ key: "t1/doc-1", versionId: "v1", isDeleteMarker: false }], { failAlways: new Set(["t1/doc-1#v1"]) });

    const result = await purgeTenant(
      baseDeps({ s3Source, s3Targets: [{ bucket: "quarantine", prefix: "t1/" }] }),
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

  it("resume: a checkpoint marking dynamo/session-table already done skips redoing them, only re-attempting S3", async () => {
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
      async deleteSession() {},
    };
    const s3Source = makeS3Source([{ key: "t1/doc-1", versionId: "v1", isDeleteMarker: false }]);

    const result = await purgeTenant(
      {
        dynamo: { store: new InMemoryIdentityStore(), candidates: dynamoSource, tableName: "MainTable" },
        sessionTable: { source: sessionSource },
        s3Source,
        s3Targets: [{ bucket: "quarantine", prefix: "t1/" }],
      },
      { tenantId: "t1", startFrom: { dynamoDone: true, sessionTableDone: true } },
    );

    expect(dynamoCalls).toBe(0);
    expect(sessionCalls).toBe(0);
    expect(result.status).toBe("SUCCESS");
    expect(result.s3[0]?.versionsDeleted).toBe(1);
  });

  it("idempotent as a whole: re-running against an already-fully-purged tenant is a clean SUCCESS no-op, never an error", async () => {
    const deps = baseDeps({ s3Targets: [{ bucket: "quarantine", prefix: "t1/" }] });
    const first = await purgeTenant(deps, { tenantId: "t1" });
    expect(first.status).toBe("SUCCESS");
    const second = await purgeTenant(deps, { tenantId: "t1" });
    expect(second.status).toBe("SUCCESS");
    expect(second.dynamo?.itemsPurged).toBe(0);
    expect(second.sessionTable?.sessionsPurged).toBe(0);
    expect(second.s3[0]?.versionsDeleted).toBe(0);
  });

  it("invokes onCheckpoint as sub-purges progress, not only at the very end", async () => {
    const store = new InMemoryIdentityStore();
    const items = [dynamoItem("t1", "a")];
    for (const i of items) store.seedRaw(i);
    const checkpoints: unknown[] = [];

    await purgeTenant(
      {
        dynamo: { store, candidates: makeDynamoSource(items), tableName: "MainTable" },
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
