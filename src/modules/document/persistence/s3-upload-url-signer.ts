/** Real presigned-URL adapter for UploadUrlSigner (M6 design §3.1). Presigns a PutObject
 * restricted to the exact key/checksum/content-type/size the caller declared - never grants a
 * broader operation, never grants read. `If-None-Match: *` (not a standard presignable header
 * for PutObject; instead we rely on the opaque random key never colliding, per design) is not
 * used - "no overwrite" is achieved by the key itself being a fresh random value per
 * reservation, matching the blueprint's actual mechanism. */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignUploadInput, PresignUploadResult, UploadUrlSigner } from "../ports/upload-url-signer.js";

export class S3UploadUrlSigner implements UploadUrlSigner {
  constructor(private readonly client: S3Client) {}

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.mediaType,
      ContentLength: input.contentLength,
      ChecksumSHA256: Buffer.from(input.checksumSha256, "hex").toString("base64"),
      ServerSideEncryption: "aws:kms",
      Metadata: input.metadata,
    });
    // Real bug found live against dev (2026-09-26, scripts/seed-dev-demo-data.mjs's first upload
    // attempt): every real upload 403'd with S3's "AccessDenied: There were headers present in
    // the request which were not signed. HeadersNotSigned: x-amz-checksum-sha256" - confirmed
    // reproducible on every single attempt (not a flake). `getSignedUrl()` does not sign an
    // `x-amz-checksum-*` header by default even when the command carries `ChecksumSHA256`; the
    // caller must explicitly list it in `unhoistableHeaders` for the presigned URL's signature
    // to actually cover it (AWS SDK v3 documented behavior/known issue,
    // https://github.com/aws/aws-sdk-js-v3/issues/3906) - without this, `requiredHeaders` below
    // instructs every real caller to send a header the URL's own signature rejects, so 100% of
    // uploads failed before this fix, not just an edge case.
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds, unhoistableHeaders: new Set(["x-amz-checksum-sha256"]) });
    return {
      uploadUrl,
      requiredHeaders: {
        "Content-Type": input.mediaType,
        "Content-Length": String(input.contentLength),
        "x-amz-checksum-sha256": Buffer.from(input.checksumSha256, "hex").toString("base64"),
        "x-amz-server-side-encryption": "aws:kms",
      },
    };
  }
}
