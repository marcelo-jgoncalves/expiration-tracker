/**
 * ReportExportStore — D-204 decision 6/7 (Roadmap P1 item 15 fatia 3). S3 surface the
 * scheduled-delivery worker (write, once per run) and the authenticated download route (read,
 * presign-on-demand) both need. One dedicated bucket/prefix, never the quarantine/clean/import
 * buckets those already serve a distinct purpose for.
 */
export interface ReportExportStore {
  /** Uploads the combined CSV for a run - idempotent overwrite (a redelivered SQS message that
   * regenerates the same run's CSV just overwrites the same key with fresh-at-that-retry data,
   * never a correctness issue since the worker never treats this write as the source of
   * "already processed" - `ReportSubscriptionRun`'s own conditional create is). */
  putCsv(input: { tenantId: string; subscriptionId: string; runId: string; body: string }): Promise<{ key: string }>;
  /** Mints a short-lived (decision 7: 5 min) presigned GET for an already-uploaded object -
   * never called until a real download request is authorized, never embedded in the e-mail
   * itself (decision 1's own closed finding: a long-TTL S3 presign is physically invalid past
   * the ~7 day SigV4 credential ceiling when signed by a Lambda role). */
  presignDownload(input: { tenantId: string; subscriptionId: string; runId: string; expiresInSeconds: number }): Promise<string>;
}
