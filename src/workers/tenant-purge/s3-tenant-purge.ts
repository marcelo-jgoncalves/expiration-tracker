/**
 * S3 tenant-prefix purge — W3-07 (this session). Design basis: `claude-analysis-active-only-
 * fence.md`'s versioned-bucket handling section — `ListObjectVersions` with pagination, deleting
 * BOTH real versions and delete markers, checking `DeleteObjects.Errors[]` (never treating HTTP
 * 200 as proof of full success), retrying failed entries, plus `ListMultipartUploads` to abort
 * incomplete multipart uploads (which never show up in `ListObjectVersions` at all — a purge that
 * only looked at object versions would silently leave these behind, still billable and still
 * "tenant data" in the LGPD sense once any part bytes were uploaded).
 *
 * Every tenant-owned bucket in this codebase is confirmed versioned (`infra/modules/document-
 * buckets/main.tf`: quarantine + clean; `infra/modules/import-bucket/main.tf`: import) EXCEPT the
 * extraction/OCR bucket, whose Terraform module was not found under `infra/modules/` with a
 * dedicated versioning resource as of this session — see `NEXT_SESSION_PROMPT.md` for the exact
 * gap and why it is deferred rather than guessed at. This module's `ListObjectVersions`-based
 * approach is CORRECT for a non-versioned bucket too (a non-versioned object shows up as a single
 * "version" with `versionId: "null"`, deleted the same way), so it works either way — the
 * open question is only whether an un-versioned OCR bucket could have already lost old object
 * content to an overwrite before purge ever runs, which no purge mechanism can retroactively fix.
 *
 * Checkpoint/resume: `keyMarker`/`versionIdMarker` (object-version pagination) and separately
 * `uploadKeyMarker`/`uploadIdMarker` (multipart pagination) are returned after every page via
 * `onCheckpoint`, so an interrupted purge resumes from the last completed page rather than
 * silently claiming completion or restarting a (potentially very large) prefix from scratch.
 * Idempotent regardless: `DeleteObjects`/`AbortMultipartUpload` are no-ops on an
 * already-gone key/version/uploadId, so even a from-scratch re-run (no checkpoint) converges
 * correctly, just less efficiently.
 */
export interface S3VersionEntry {
  key: string;
  versionId: string;
  isDeleteMarker: boolean;
}

export interface S3VersionListPage {
  versions: S3VersionEntry[];
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
}

export interface S3DeleteError {
  key: string;
  versionId?: string;
  code: string;
  message: string;
}

export interface S3DeleteObjectsResult {
  deletedCount: number;
  errors: S3DeleteError[];
}

export interface S3MultipartUploadEntry {
  key: string;
  uploadId: string;
}

export interface S3MultipartUploadListPage {
  uploads: S3MultipartUploadEntry[];
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextUploadIdMarker?: string;
}

/** Minimal S3 surface this module needs — real adapter in `shared/s3/tenant-purge-s3-adapter.ts`. */
export interface S3PurgeSource {
  listObjectVersions(bucket: string, prefix: string, keyMarker?: string, versionIdMarker?: string): Promise<S3VersionListPage>;
  /** Batch delete (max 1000 entries per call, same as the real `DeleteObjects` API limit — this
   * module never hands it more than that). MUST surface partial failures via `errors`, never
   * collapse them into an exception or a bare success. */
  deleteObjects(bucket: string, entries: Array<{ key: string; versionId: string }>): Promise<S3DeleteObjectsResult>;
  listMultipartUploads(bucket: string, prefix: string, keyMarker?: string, uploadIdMarker?: string): Promise<S3MultipartUploadListPage>;
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void>;
}

const DELETE_BATCH_SIZE = 1000;
const MAX_DELETE_RETRIES = 3;

export interface S3TenantPurgeCheckpoint {
  keyMarker?: string;
  versionIdMarker?: string;
  /** `true` once the version-listing phase has fully converged (an empty, non-truncated final
   * page) — only then does the multipart-abort phase begin. Lets a resumed run skip re-doing the
   * (typically much larger) version phase if it already finished. */
  versionsDone?: boolean;
  uploadKeyMarker?: string;
  uploadIdMarker?: string;
}

export interface S3TenantPurgeDeps {
  source: S3PurgeSource;
  onCheckpoint?: (checkpoint: S3TenantPurgeCheckpoint) => Promise<void>;
}

export interface S3TenantPurgeResult {
  bucket: string;
  prefix: string;
  versionsDeleted: number;
  deleteMarkersDeleted: number;
  multipartUploadsAborted: number;
  /** Any `DeleteObjects.Errors[]` entries that survived `MAX_DELETE_RETRIES` retry attempts —
   * non-empty means this bucket/prefix did NOT converge to zero physical objects. Callers
   * (`purge-tenant.ts`) MUST treat a non-empty array as a PARTIAL outcome, never as success. */
  unresolvedErrors: S3DeleteError[];
  checkpoint: S3TenantPurgeCheckpoint;
}

async function deleteWithRetry(source: S3PurgeSource, bucket: string, entries: S3VersionEntry[]): Promise<{ deletedCount: number; errors: S3DeleteError[] }> {
  let pending = entries.map((e) => ({ key: e.key, versionId: e.versionId }));
  let deletedCount = 0;
  let lastErrors: S3DeleteError[] = [];

  for (let attempt = 0; attempt < MAX_DELETE_RETRIES && pending.length > 0; attempt++) {
    const result = await source.deleteObjects(bucket, pending);
    deletedCount += result.deletedCount;
    lastErrors = result.errors;
    if (result.errors.length === 0) return { deletedCount, errors: [] };
    // Retry only the entries that actually failed, never blindly re-send everything (avoids
    // double-counting a partially-successful batch on retry).
    pending = result.errors.map((e) => ({ key: e.key, versionId: e.versionId ?? "" }));
  }

  return { deletedCount, errors: lastErrors };
}

/** Same rationale as `dynamo-tenant-purge.ts`'s `verifyTenantDynamoPurgeEmpty` (B2) — a full,
 * unconditional re-listing of both object versions/delete markers AND incomplete multipart
 * uploads under `bucket`/`prefix`, ignoring any `versionsDone` checkpoint. `purge-tenant.ts`
 * calls this unconditionally after each S3 target's purge attempt, so a persisted
 * `versionsDone: true` from an earlier pass (which used to make a resumed run skip listing
 * entirely — the exact scenario the approved design's "re-scan vazio" requirement exists to
 * catch) can never by itself cause a false SUCCESS. */
export async function verifyS3TenantPrefixEmpty(
  deps: Pick<S3TenantPurgeDeps, "source">,
  input: { bucket: string; prefix: string },
): Promise<{ remainingVersions: number; remainingMultipartUploads: number }> {
  let remainingVersions = 0;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  for (;;) {
    const page = await deps.source.listObjectVersions(input.bucket, input.prefix, keyMarker, versionIdMarker);
    remainingVersions += page.versions.length;
    keyMarker = page.nextKeyMarker;
    versionIdMarker = page.nextVersionIdMarker;
    if (!page.isTruncated) break;
  }

  let remainingMultipartUploads = 0;
  let uploadKeyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  for (;;) {
    const page = await deps.source.listMultipartUploads(input.bucket, input.prefix, uploadKeyMarker, uploadIdMarker);
    remainingMultipartUploads += page.uploads.length;
    uploadKeyMarker = page.nextKeyMarker;
    uploadIdMarker = page.nextUploadIdMarker;
    if (!page.isTruncated) break;
  }

  return { remainingVersions, remainingMultipartUploads };
}

export async function purgeS3TenantPrefix(
  deps: S3TenantPurgeDeps,
  input: { bucket: string; prefix: string; startFrom?: S3TenantPurgeCheckpoint },
): Promise<S3TenantPurgeResult> {
  const checkpoint: S3TenantPurgeCheckpoint = { ...input.startFrom };
  let versionsDeleted = 0;
  let deleteMarkersDeleted = 0;
  let multipartUploadsAborted = 0;
  const unresolvedErrors: S3DeleteError[] = [];

  if (!checkpoint.versionsDone) {
    let keyMarker = checkpoint.keyMarker;
    let versionIdMarker = checkpoint.versionIdMarker;

    for (;;) {
      const page = await deps.source.listObjectVersions(input.bucket, input.prefix, keyMarker, versionIdMarker);

      if (page.versions.length > 0) {
        // Batch in chunks of DELETE_BATCH_SIZE — real DeleteObjects caps at 1000 per call.
        for (let i = 0; i < page.versions.length; i += DELETE_BATCH_SIZE) {
          const batch = page.versions.slice(i, i + DELETE_BATCH_SIZE);
          const { errors } = await deleteWithRetry(deps.source, input.bucket, batch);
          // Count by type from the batch minus unresolved errors (errors reference the exact
          // key/versionId that failed) — DeleteObjects has no per-success-entry detail, only
          // Errors[], so "everything in the batch except what's in errors" is the actual
          // success set.
          const failedKeys = new Set(errors.map((e) => `${e.key}#${e.versionId ?? ""}`));
          for (const entry of batch) {
            const k = `${entry.key}#${entry.versionId}`;
            if (failedKeys.has(k)) continue;
            if (entry.isDeleteMarker) deleteMarkersDeleted += 1;
            else versionsDeleted += 1;
          }
          unresolvedErrors.push(...errors);
        }
      }

      keyMarker = page.nextKeyMarker;
      versionIdMarker = page.nextVersionIdMarker;
      checkpoint.keyMarker = keyMarker;
      checkpoint.versionIdMarker = versionIdMarker;
      if (deps.onCheckpoint) await deps.onCheckpoint({ ...checkpoint });

      if (!page.isTruncated) break;
    }

    // Never claim convergence while unresolved errors remain — a page that had errors is NOT
    // "done" even if isTruncated became false, because at least one object is still physically
    // present. Convergence requires an empty error set for the whole prefix.
    checkpoint.versionsDone = unresolvedErrors.length === 0;
    if (deps.onCheckpoint) await deps.onCheckpoint({ ...checkpoint });
  }

  // Multipart uploads never appear in ListObjectVersions — separate enumeration, required per
  // the approved design (file header). Only proceed once the version phase converged; if it
  // didn't, still surface unresolvedErrors below without pretending multipart cleanup ran.
  if (checkpoint.versionsDone) {
    let uploadKeyMarker = checkpoint.uploadKeyMarker;
    let uploadIdMarker = checkpoint.uploadIdMarker;

    for (;;) {
      const page = await deps.source.listMultipartUploads(input.bucket, input.prefix, uploadKeyMarker, uploadIdMarker);
      for (const upload of page.uploads) {
        await deps.source.abortMultipartUpload(input.bucket, upload.key, upload.uploadId);
        multipartUploadsAborted += 1;
      }

      uploadKeyMarker = page.nextKeyMarker;
      uploadIdMarker = page.nextUploadIdMarker;
      checkpoint.uploadKeyMarker = uploadKeyMarker;
      checkpoint.uploadIdMarker = uploadIdMarker;
      if (deps.onCheckpoint) await deps.onCheckpoint({ ...checkpoint });

      if (!page.isTruncated) break;
    }
  }

  return {
    bucket: input.bucket,
    prefix: input.prefix,
    versionsDeleted,
    deleteMarkersDeleted,
    multipartUploadsAborted,
    unresolvedErrors,
    checkpoint,
  };
}
