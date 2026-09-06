/** Real S3 adapter for DossierExportStore (D-205 fatia 2/3). Reuses the SAME `report_exports`
 * bucket `S3ReportExportStore` (D-204) already writes to, under its own key prefix - see that
 * port's own header comment for why this is deliberate reuse, not a new bucket. */
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DossierExportFormat, DossierExportStore } from "../ports/dossier-export-store.js";

function dossierExportObjectKey(tenantId: string, subjectId: string, runId: string, format: DossierExportFormat): string {
  return `tenants/${tenantId}/dossier-exports/${subjectId}/runs/${runId}/dossier.${format}`;
}

const CONTENT_TYPE: Record<DossierExportFormat, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export class S3DossierExportStore implements DossierExportStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putPdf(input: { tenantId: string; subjectId: string; runId: string; body: Uint8Array }): Promise<void> {
    await this.put(input.tenantId, input.subjectId, input.runId, "pdf", input.body);
  }

  async putXlsx(input: { tenantId: string; subjectId: string; runId: string; body: Buffer }): Promise<void> {
    await this.put(input.tenantId, input.subjectId, input.runId, "xlsx", input.body);
  }

  private async put(tenantId: string, subjectId: string, runId: string, format: DossierExportFormat, body: Uint8Array): Promise<void> {
    const key = dossierExportObjectKey(tenantId, subjectId, runId, format);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: CONTENT_TYPE[format], ServerSideEncryption: "AES256" }));
  }

  async presignDownload(input: { tenantId: string; subjectId: string; runId: string; format: DossierExportFormat; expiresInSeconds: number }): Promise<string> {
    const key = dossierExportObjectKey(input.tenantId, input.subjectId, input.runId, input.format);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
  }
}
