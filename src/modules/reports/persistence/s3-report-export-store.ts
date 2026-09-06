/** Real S3 adapter for ReportExportStore (D-204 fatia 3). One bucket
 * (`REPORT_EXPORTS_BUCKET_NAME`, `infra/main.tf`'s `aws_s3_bucket.report_exports` - SSE-S3,
 * public access blocked, 30-day lifecycle expiration per decision 6), key format owned entirely
 * here so the worker (write) and the download route (read) can never drift on how a run's
 * object is addressed. */
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ReportExportStore } from "../ports/report-export-store.js";

function reportExportObjectKey(tenantId: string, subscriptionId: string, runId: string): string {
  return `tenants/${tenantId}/report-subscriptions/${subscriptionId}/runs/${runId}.csv`;
}

export class S3ReportExportStore implements ReportExportStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putCsv(input: { tenantId: string; subscriptionId: string; runId: string; body: string }): Promise<{ key: string }> {
    const key = reportExportObjectKey(input.tenantId, input.subscriptionId, input.runId);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: "text/csv; charset=utf-8",
        ServerSideEncryption: "AES256",
      }),
    );
    return { key };
  }

  async presignDownload(input: { tenantId: string; subscriptionId: string; runId: string; expiresInSeconds: number }): Promise<string> {
    const key = reportExportObjectKey(input.tenantId, input.subscriptionId, input.runId);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }
}
