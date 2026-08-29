import { describe, expect, it } from "vitest";
import { purgeS3TenantPrefix, type S3PurgeSource, type S3VersionEntry, type S3MultipartUploadEntry } from "../../../../src/workers/tenant-purge/s3-tenant-purge.js";

/** In-memory fake S3 bucket: versions/delete-markers + multipart uploads, paginated. */
class FakeS3Bucket implements S3PurgeSource {
  versions: S3VersionEntry[];
  uploads: S3MultipartUploadEntry[];
  /** key#versionId set that should fail deleteObjects on their FIRST attempt only (simulates a
   * transient per-object failure that succeeds on retry). */
  failOnce: Set<string>;
  /** key#versionId set that should fail deleteObjects EVERY attempt (simulates a permanent
   * per-object failure). */
  failAlways: Set<string>;
  deleteObjectsCalls = 0;
  abortedUploads: S3MultipartUploadEntry[] = [];

  constructor(opts: { versions?: S3VersionEntry[]; uploads?: S3MultipartUploadEntry[]; failOnce?: string[]; failAlways?: string[] } = {}) {
    this.versions = opts.versions ?? [];
    this.uploads = opts.uploads ?? [];
    this.failOnce = new Set(opts.failOnce ?? []);
    this.failAlways = new Set(opts.failAlways ?? []);
  }

  async listObjectVersions(_bucket: string, prefix: string, keyMarker?: string, versionIdMarker?: string) {
    // Marker-based (not index-based) pagination, same rationale as
    // session-table-tenant-purge.test.ts's fake: resuming correctly even as earlier pages get
    // deleted between calls, matching real S3/DynamoDB pagination semantics.
    const marker = keyMarker && versionIdMarker ? `${keyMarker}#${versionIdMarker}` : undefined;
    const matching = this.versions.filter((v) => v.key.startsWith(prefix)).sort((a, b) => `${a.key}#${a.versionId}`.localeCompare(`${b.key}#${b.versionId}`));
    const startIndex = marker ? matching.findIndex((v) => `${v.key}#${v.versionId}` > marker) : 0;
    const effectiveStart = startIndex === -1 ? matching.length : startIndex;
    const pageSize = 2;
    const page = matching.slice(effectiveStart, effectiveStart + pageSize);
    const isTruncated = effectiveStart + pageSize < matching.length;
    const last = page.at(-1);
    return { versions: page, isTruncated, nextKeyMarker: isTruncated ? last?.key : undefined, nextVersionIdMarker: isTruncated ? last?.versionId : undefined };
  }

  async deleteObjects(_bucket: string, entries: Array<{ key: string; versionId: string }>) {
    this.deleteObjectsCalls += 1;
    const errors: Array<{ key: string; versionId?: string; code: string; message: string }> = [];
    let deletedCount = 0;
    for (const entry of entries) {
      const k = `${entry.key}#${entry.versionId}`;
      if (this.failAlways.has(k)) {
        errors.push({ key: entry.key, versionId: entry.versionId, code: "InternalError", message: "permanent failure" });
        continue;
      }
      if (this.failOnce.has(k)) {
        this.failOnce.delete(k); // succeeds next time
        errors.push({ key: entry.key, versionId: entry.versionId, code: "InternalError", message: "transient failure" });
        continue;
      }
      this.versions = this.versions.filter((v) => !(v.key === entry.key && v.versionId === entry.versionId));
      deletedCount += 1;
    }
    return { deletedCount, errors };
  }

  async listMultipartUploads(_bucket: string, prefix: string, keyMarker?: string, uploadIdMarker?: string) {
    const marker = keyMarker && uploadIdMarker ? `${keyMarker}#${uploadIdMarker}` : undefined;
    const matching = this.uploads.filter((u) => u.key.startsWith(prefix)).sort((a, b) => `${a.key}#${a.uploadId}`.localeCompare(`${b.key}#${b.uploadId}`));
    const startIndex = marker ? matching.findIndex((u) => `${u.key}#${u.uploadId}` > marker) : 0;
    const effectiveStart = startIndex === -1 ? matching.length : startIndex;
    const pageSize = 2;
    const page = matching.slice(effectiveStart, effectiveStart + pageSize);
    const isTruncated = effectiveStart + pageSize < matching.length;
    const last = page.at(-1);
    return { uploads: page, isTruncated, nextKeyMarker: isTruncated ? last?.key : undefined, nextUploadIdMarker: isTruncated ? last?.uploadId : undefined };
  }

  async abortMultipartUpload(_bucket: string, key: string, uploadId: string): Promise<void> {
    this.abortedUploads.push({ key, uploadId });
    this.uploads = this.uploads.filter((u) => !(u.key === key && u.uploadId === uploadId));
  }
}

describe("purgeS3TenantPrefix", () => {
  it("paginates across multiple ListObjectVersions pages and deletes every version and delete marker", async () => {
    const bucket = new FakeS3Bucket({
      versions: [
        { key: "t1/a", versionId: "v1", isDeleteMarker: false },
        { key: "t1/a", versionId: "v2", isDeleteMarker: true },
        { key: "t1/b", versionId: "v1", isDeleteMarker: false },
        { key: "t1/c", versionId: "v1", isDeleteMarker: false },
        { key: "t1/c", versionId: "v2", isDeleteMarker: false },
      ],
    });

    const result = await purgeS3TenantPrefix({ source: bucket }, { bucket: "b", prefix: "t1/" });

    expect(result.versionsDeleted).toBe(4);
    expect(result.deleteMarkersDeleted).toBe(1);
    expect(result.unresolvedErrors).toEqual([]);
    expect(bucket.versions).toEqual([]);
    expect(result.checkpoint.versionsDone).toBe(true);
  });

  it("handles DeleteObjects.Errors[] correctly: a transient per-object failure is retried and eventually succeeds, never silently reported as full success on the first attempt alone", async () => {
    const bucket = new FakeS3Bucket({
      versions: [{ key: "t1/a", versionId: "v1", isDeleteMarker: false }],
      failOnce: ["t1/a#v1"],
    });

    const result = await purgeS3TenantPrefix({ source: bucket }, { bucket: "b", prefix: "t1/" });

    expect(result.versionsDeleted).toBe(1);
    expect(result.unresolvedErrors).toEqual([]);
    expect(bucket.deleteObjectsCalls).toBeGreaterThanOrEqual(2); // first attempt failed, retry succeeded
  });

  it("a permanent partial failure is surfaced in unresolvedErrors, never masked as full success, and versionsDone stays false", async () => {
    const bucket = new FakeS3Bucket({
      versions: [
        { key: "t1/a", versionId: "v1", isDeleteMarker: false },
        { key: "t1/b", versionId: "v1", isDeleteMarker: false },
      ],
      failAlways: ["t1/a#v1"],
    });

    const result = await purgeS3TenantPrefix({ source: bucket }, { bucket: "b", prefix: "t1/" });

    expect(result.versionsDeleted).toBe(1); // t1/b succeeded
    expect(result.unresolvedErrors).toHaveLength(1);
    expect(result.unresolvedErrors[0]?.key).toBe("t1/a");
    expect(result.checkpoint.versionsDone).toBe(false);
    // The still-failing object must still be physically present.
    expect(bucket.versions.some((v) => v.key === "t1/a")).toBe(true);
  });

  it("does not proceed to multipart-abort phase while the version phase has unresolved errors", async () => {
    const bucket = new FakeS3Bucket({
      versions: [{ key: "t1/a", versionId: "v1", isDeleteMarker: false }],
      failAlways: ["t1/a#v1"],
      uploads: [{ key: "t1/incomplete", uploadId: "upload-1" }],
    });

    const result = await purgeS3TenantPrefix({ source: bucket }, { bucket: "b", prefix: "t1/" });

    expect(result.multipartUploadsAborted).toBe(0);
    expect(bucket.abortedUploads).toEqual([]);
  });

  it("aborts every incomplete multipart upload for the tenant's prefix once the version phase converges, across pages", async () => {
    const bucket = new FakeS3Bucket({
      uploads: [
        { key: "t1/incomplete-a", uploadId: "upload-1" },
        { key: "t1/incomplete-b", uploadId: "upload-2" },
        { key: "t1/incomplete-c", uploadId: "upload-3" },
      ],
    });

    const result = await purgeS3TenantPrefix({ source: bucket }, { bucket: "b", prefix: "t1/" });

    expect(result.multipartUploadsAborted).toBe(3);
    expect(bucket.uploads).toEqual([]);
  });

  it("checkpoint/resume: a run that stops after the version phase (via startFrom) resumes into the multipart phase without redoing already-converged version deletes", async () => {
    const bucket = new FakeS3Bucket({
      versions: [{ key: "t1/a", versionId: "v1", isDeleteMarker: false }],
      uploads: [{ key: "t1/incomplete", uploadId: "upload-1" }],
    });

    // Simulate a resumed run: versions already deleted out-of-band, checkpoint says versionsDone.
    bucket.versions = [];
    const result = await purgeS3TenantPrefix({ source: bucket }, { bucket: "b", prefix: "t1/", startFrom: { versionsDone: true } });

    expect(result.versionsDeleted).toBe(0);
    expect(result.multipartUploadsAborted).toBe(1);
  });

  it("checkpoint/resume: an interrupted version-listing phase resumes from the last reported keyMarker instead of restarting or silently claiming completion", async () => {
    const bucket = new FakeS3Bucket({
      versions: [
        { key: "t1/a", versionId: "v1", isDeleteMarker: false },
        { key: "t1/b", versionId: "v1", isDeleteMarker: false },
        { key: "t1/c", versionId: "v1", isDeleteMarker: false },
      ],
    });

    const checkpoints: Array<{ keyMarker?: string; versionsDone?: boolean }> = [];
    await purgeS3TenantPrefix(
      { source: bucket, onCheckpoint: async (cp) => void checkpoints.push({ ...cp }) },
      { bucket: "b", prefix: "t1/" },
    );

    // First page checkpoint should have a keyMarker (more pages remained) and versionsDone
    // still falsy at that point.
    expect(checkpoints[0]?.keyMarker).toBeDefined();
    expect(checkpoints[0]?.versionsDone).toBeFalsy();
    // Final checkpoint reports full convergence.
    expect(checkpoints.at(-1)?.versionsDone).toBe(true);
  });

  it("idempotent: re-running against an already-fully-purged prefix is a clean no-op", async () => {
    const bucket = new FakeS3Bucket({ versions: [], uploads: [] });
    const result = await purgeS3TenantPrefix({ source: bucket }, { bucket: "b", prefix: "t1/" });
    expect(result.versionsDeleted).toBe(0);
    expect(result.multipartUploadsAborted).toBe(0);
    expect(result.unresolvedErrors).toEqual([]);
    expect(result.checkpoint.versionsDone).toBe(true);
  });
});
