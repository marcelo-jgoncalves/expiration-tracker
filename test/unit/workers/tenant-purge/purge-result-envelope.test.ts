import { describe, expect, it } from "vitest";
import { toTenantPurgeEnvelope } from "../../../../src/workers/tenant-purge/purge-result-envelope.js";
import type { TenantPurgeResult } from "../../../../src/workers/tenant-purge/purge-tenant.js";
import type { S3TenantPurgeResult } from "../../../../src/workers/tenant-purge/s3-tenant-purge.js";

function s3Result(overrides: Partial<S3TenantPurgeResult> = {}): S3TenantPurgeResult {
  return {
    bucket: "clean-bucket",
    prefix: "clean/tenant-1/",
    versionsDeleted: 0,
    deleteMarkersDeleted: 0,
    multipartUploadsAborted: 0,
    unresolvedErrors: [],
    checkpoint: { versionsDone: true },
    ...overrides,
  } as S3TenantPurgeResult;
}

describe("toTenantPurgeEnvelope (D-121 Rodada 3 Fix 6)", () => {
  it("never carries the unbounded unresolvedErrors arrays across the Step Functions boundary", () => {
    // The real risk this projection exists for: each unresolvedErrors entry is a full
    // {key, versionId, code, message} object and there is one per failed DeleteObjects call, so a
    // large tenant can blow past Step Functions' 256 KiB task output quota. Mutation that would
    // catch a regression: returning `result` (or spreading it) instead of the projection - this
    // assertion fails immediately because the s3 arrays reappear.
    const result: TenantPurgeResult = {
      status: "PARTIAL",
      tenantId: "tenant-1",
      s3: [
        s3Result({ unresolvedErrors: Array.from({ length: 500 }, (_, i) => ({ key: `clean/tenant-1/doc-${i}`, versionId: `v${i}`, code: "InternalError", message: "boom" })) }),
        s3Result({ bucket: "quarantine-bucket", prefix: "tenant/tenant-1/", unresolvedErrors: [{ key: "tenant/tenant-1/x", versionId: "v", code: "AccessDenied", message: "no" }] }),
      ],
      checkpoint: { dynamoDone: true },
    };

    const envelope = toTenantPurgeEnvelope(result);

    expect(JSON.stringify(envelope)).not.toContain("unresolvedErrors");
    expect(JSON.stringify(envelope)).not.toContain("InternalError");
    expect(envelope.counters.s3UnresolvedCount).toBe(501);
    // The checkpoint IS bounded (pagination markers only) and must survive unchanged - it is what
    // makes the Choice loop's PARTIAL retry resumable rather than restarting from zero.
    expect(envelope.checkpoint).toEqual({ dynamoDone: true });
    expect(envelope.status).toBe("PARTIAL");
  });

  it("reports zeroed counters (never absent fields) on SUCCESS so the ASL never branches on undefined", () => {
    const envelope = toTenantPurgeEnvelope({ status: "SUCCESS", tenantId: "tenant-1", s3: [s3Result()] });

    expect(envelope.counters).toEqual({ s3UnresolvedCount: 0, dynamoRejectedCount: 0, sessionRejectedCount: 0 });
    // Explicitly null, never absent: the ASL's ResultSelector reads both by JSONPath, and a
    // reference to a MISSING path is a hard States.Runtime failure rather than a null. Mutation
    // that must fail: omitting the keys when there is no checkpoint/failure (the natural
    // spread-conditional form) breaks every SUCCESS execution at the RunPurge boundary.
    expect(envelope.checkpoint).toBeNull();
    expect(envelope.failure).toBeNull();
    expect(Object.keys(envelope).sort()).toEqual(["checkpoint", "counters", "failure", "status"]);
  });

  it("aggregates the DynamoDB and session-table safety-condition rejections that also disprove convergence", () => {
    const envelope = toTenantPurgeEnvelope({
      status: "PARTIAL",
      tenantId: "tenant-1",
      dynamo: { itemsPurged: 10, itemsExcluded: 1, itemsRejectedBySafetyCondition: 3, checkpoint: undefined },
      sessionTable: { sessionsPurged: 2, sessionsRejectedBySafetyCondition: 4 },
      s3: [],
    });

    expect(envelope.counters.dynamoRejectedCount).toBe(3);
    expect(envelope.counters.sessionRejectedCount).toBe(4);
  });

  it("keeps the (already small) failure field so MarkBlocked can record why a FAILED purge failed", () => {
    const envelope = toTenantPurgeEnvelope({
      status: "FAILED",
      tenantId: "tenant-1",
      s3: [],
      failure: { stage: "S3", message: "bucket unreachable" },
    });

    expect(envelope.failure).toEqual({ stage: "S3", message: "bucket unreachable" });
  });
});
