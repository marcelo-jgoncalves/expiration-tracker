/** Real S3 adapter for `OcrArtifactStore`, writing to the `EXTRACTION_TRANSIENT` bucket
 * (`privacy-lgpd.md` §4). `delete()` is used ONLY by `ExtractionValidationTaskHandler` (M7 item
 * 7) — see the port's doc comment for why this method exists at all. */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { OcrArtifactStore, ExtractionArtifactRef } from "../ports/ocr-artifact-store.js";

export class S3OcrArtifactStore implements OcrArtifactStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(runId: string, blocksJson: string): Promise<ExtractionArtifactRef> {
    const key = `ocr/${runId}/${randomUUID()}.json`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: blocksJson,
        ContentType: "application/json",
      }),
    );
    return { bucket: this.bucket, key };
  }

  async get(ref: ExtractionArtifactRef): Promise<string> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
    if (!result.Body) {
      throw new Error(`OCR artifact ${ref.bucket}/${ref.key} returned no body.`);
    }
    return result.Body.transformToString("utf-8");
  }

  async delete(ref: ExtractionArtifactRef): Promise<void> {
    // DeleteObjectCommand is already idempotent at the S3 API level (deleting a missing key
    // returns success, never a 404) - no extra existence check needed here.
    await this.client.send(new DeleteObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
  }
}

export function createS3Client(): S3Client {
  return new S3Client({});
}
