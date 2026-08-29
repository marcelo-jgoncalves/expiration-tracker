/**
 * Real S3 adapter for the W3-07 purge pipeline (`workers/tenant-purge/s3-tenant-purge.ts`'s
 * `S3PurgeSource` port). Not covered by `.dependency-cruiser.cjs`'s DynamoDB boundary rule (S3
 * isn't a tenant-fenced write path in the same sense — see `w3-07-writer-inventory.md`'s
 * "NOT FENCED (by design)" rows), so this lives under `shared/s3/` rather than a specific
 * module's `persistence/`, matching this pipeline's cross-module scope (quarantine/clean/import/
 * OCR buckets each belong to a different module).
 */
import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import type {
  S3PurgeSource,
  S3VersionListPage,
  S3DeleteObjectsResult,
  S3MultipartUploadListPage,
} from "../../workers/tenant-purge/s3-tenant-purge.js";

const LIST_PAGE_SIZE = 1000;

export class S3TenantPurgeAdapter implements S3PurgeSource {
  constructor(private readonly client: S3Client) {}

  async listObjectVersions(bucket: string, prefix: string, keyMarker?: string, versionIdMarker?: string): Promise<S3VersionListPage> {
    const result = await this.client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
        MaxKeys: LIST_PAGE_SIZE,
      }),
    );

    const versions = (result.Versions ?? []).map((v) => ({
      key: v.Key ?? "",
      versionId: v.VersionId ?? "null",
      isDeleteMarker: false,
    }));
    const deleteMarkers = (result.DeleteMarkers ?? []).map((m) => ({
      key: m.Key ?? "",
      versionId: m.VersionId ?? "null",
      isDeleteMarker: true,
    }));

    return {
      versions: [...versions, ...deleteMarkers],
      isTruncated: result.IsTruncated ?? false,
      nextKeyMarker: result.NextKeyMarker,
      nextVersionIdMarker: result.NextVersionIdMarker,
    };
  }

  /** MUST NOT treat a 200 response as proof every object was removed — `DeleteObjects.Errors[]`
   * is the authoritative per-object outcome (an HTTP-level success can still carry per-key
   * failures, e.g. an object under a legal hold or a transient throttle on one key of a batch). */
  async deleteObjects(bucket: string, entries: Array<{ key: string; versionId: string }>): Promise<S3DeleteObjectsResult> {
    if (entries.length === 0) return { deletedCount: 0, errors: [] };
    const result = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: entries.map((e) => ({ Key: e.key, VersionId: e.versionId === "null" ? undefined : e.versionId })),
          Quiet: false,
        },
      }),
    );
    const errors = (result.Errors ?? []).map((e) => ({
      key: e.Key ?? "",
      versionId: e.VersionId,
      code: e.Code ?? "Unknown",
      message: e.Message ?? "",
    }));
    return { deletedCount: (result.Deleted ?? []).length, errors };
  }

  async listMultipartUploads(bucket: string, prefix: string, keyMarker?: string, uploadIdMarker?: string): Promise<S3MultipartUploadListPage> {
    const result = await this.client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
        MaxUploads: LIST_PAGE_SIZE,
      }),
    );
    return {
      uploads: (result.Uploads ?? []).map((u) => ({ key: u.Key ?? "", uploadId: u.UploadId ?? "" })),
      isTruncated: result.IsTruncated ?? false,
      nextKeyMarker: result.NextKeyMarker,
      nextUploadIdMarker: result.NextUploadIdMarker,
    };
  }

  async abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void> {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  }
}

export function createS3PurgeClient(): S3Client {
  return new S3Client({});
}
