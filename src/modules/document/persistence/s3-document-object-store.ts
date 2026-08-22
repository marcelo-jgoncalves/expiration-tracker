/** Real S3 adapter for DocumentObjectStore (M6). Every operation is scoped to an exact
 * bucket/key/versionId - never a bare key - per M6 design §"Decisões-chave" (identidade
 * imutável de objeto). */
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { DocumentObjectReference } from "../domain/document-object-reference.js";
import type { DocumentObjectStore, ObjectMetadata } from "../ports/document-object-store.js";

export class S3DocumentObjectStore implements DocumentObjectStore {
  constructor(private readonly client: S3Client) {}

  async headObject(ref: DocumentObjectReference): Promise<ObjectMetadata | undefined> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key, VersionId: ref.versionId }));
      return {
        contentLength: result.ContentLength ?? 0,
        mediaType: result.ContentType ?? "application/octet-stream",
        checksumSha256: result.ChecksumSHA256,
      };
    } catch (err) {
      if (typeof err === "object" && err !== null && "name" in err && (err as { name?: unknown }).name === "NotFound") {
        return undefined;
      }
      throw err;
    }
  }

  async copyObject(source: DocumentObjectReference, destinationBucket: string, destinationKey: string): Promise<DocumentObjectReference> {
    // Real bug found via Camada 3 (2026-08-22): encodeURIComponent() on the FULL key also
    // encodes its "/" path separators as "%2F", producing a CopySource that doesn't resolve to
    // any real object (S3 keys use literal "/" as the segment delimiter; only the characters
    // WITHIN each segment need escaping). Every quarantine key has multiple "/" segments
    // (tenant/<id>/item/<id>/document/<id>/slot/<id>/<uuid>), so this affected every real
    // promotion attempt - confirmed via a real CopyObjectCommand failing with an opaque
    // "UnknownError" (S3's error response for a CopySource that doesn't parse as a real
    // bucket/key/versionId triple). Fixed by escaping each path segment independently.
    const encodedKey = source.key.split("/").map(encodeURIComponent).join("/");
    const result = await this.client.send(
      new CopyObjectCommand({
        Bucket: destinationBucket,
        Key: destinationKey,
        CopySource: `${source.bucket}/${encodedKey}?versionId=${source.versionId}`,
        ServerSideEncryption: "aws:kms",
      }),
    );
    return { bucket: destinationBucket, key: destinationKey, versionId: result.VersionId ?? "" };
  }

  async deleteObjectVersion(ref: DocumentObjectReference): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: ref.bucket, Key: ref.key, VersionId: ref.versionId }));
  }
}

export function createS3Client(): S3Client {
  return new S3Client({});
}
