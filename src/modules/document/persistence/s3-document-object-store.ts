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
    const result = await this.client.send(
      new CopyObjectCommand({
        Bucket: destinationBucket,
        Key: destinationKey,
        CopySource: `${source.bucket}/${encodeURIComponent(source.key)}?versionId=${source.versionId}`,
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
