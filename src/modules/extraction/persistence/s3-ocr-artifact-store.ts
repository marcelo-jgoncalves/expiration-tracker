/** Real S3 adapter for `OcrArtifactStore`, writing to the `EXTRACTION_TRANSIENT` bucket
 * (`privacy-lgpd.md` §4). Deliberately has no delete method (matches the port) — the artifact is
 * only ever removed by `ExtractionValidationTaskHandler` (not yet implemented) or the bucket's
 * own 24h lifecycle safety net. */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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
}

export function createS3Client(): S3Client {
  return new S3Client({});
}
