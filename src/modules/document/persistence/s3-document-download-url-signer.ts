/** D-313 (2026-09-21) - mirrors `document-archive/persistence/s3-external-share-link-file-store.ts`'s
 * `S3ExternalShareLinkFileStore` line for line (same GetObjectCommand + getSignedUrl + sanitized
 * ResponseContentDisposition pattern, already `APPROVED`/in production for that module) - reuse
 * of an already-approved pattern against a new port, not a new design. */
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DocumentDownloadUrlSigner } from "../ports/document-download-url-signer.js";

export class S3DocumentDownloadUrlSigner implements DocumentDownloadUrlSigner {
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
