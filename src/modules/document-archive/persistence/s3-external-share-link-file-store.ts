/** Real S3 adapter for `ExternalShareLinkFileStore` (D-225 Decision 5) — presigns a GET directly
 * against the frozen `DocumentObjectReference` triple (bucket+key+versionId), the same object
 * identity discipline `sameObjectVersion()` already enforces elsewhere in this module. Sets
 * `ResponseContentDisposition` to the sanitized `fileName` snapshot so the visitor's browser saves
 * the file under a sensible name without this adapter ever needing to read/rename the object. */
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ExternalShareLinkFileStore } from "../ports/external-share-link-file-store.js";

export class S3ExternalShareLinkFileStore implements ExternalShareLinkFileStore {
  constructor(private readonly client: S3Client) {}

  async presignDownload(input: { objectRef: { bucket: string; key: string; versionId: string }; fileName: string; expiresInSeconds: number }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: input.objectRef.bucket,
      Key: input.objectRef.key,
      VersionId: input.objectRef.versionId,
      ResponseContentDisposition: `attachment; filename="${input.fileName.replace(/["\\]/g, "_")}"`,
    });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }
}
