/**
 * DossierExportStore — D-205 decisions 8/9 (Roadmap P1 item 16, fatia 2/3). S3 surface the
 * generation worker (write, once per run) and the authenticated download route (read,
 * presign-on-demand) both need. Reuses the SAME `report_exports` bucket D-204's
 * `ReportExportStore` already provisions (SSE-S3, public access blocked, 30-day lifecycle,
 * `infra/main.tf`'s `aws_s3_bucket.report_exports`) under a distinct key prefix — a dossier
 * export has the identical retention/security profile a scheduled report does, so this is
 * deliberate infrastructure reuse, not a new bucket resource.
 */
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type DossierExportFormat = "pdf" | "xlsx";

export interface DossierExportStore {
  putPdf(input: { tenantId: AuthorizedTenantId; subjectId: string; runId: string; body: Uint8Array }): Promise<void>;
  putXlsx(input: { tenantId: AuthorizedTenantId; subjectId: string; runId: string; body: Buffer }): Promise<void>;
  /** Mints a short-lived (decision 9: 5 min, same as D-204 decision 7) presigned GET for an
   * already-uploaded artifact — never called until a real download request is authorized. */
  presignDownload(input: { tenantId: AuthorizedTenantId; subjectId: string; runId: string; format: DossierExportFormat; expiresInSeconds: number }): Promise<string>;
}
