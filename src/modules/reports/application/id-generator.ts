/** Same injectable-id-generator pattern as `document-archive/application/id-generator.ts` —
 * production wiring uses real ULIDs, tests inject deterministic sequences. */
export interface ReportSubscriptionIdGenerator {
  newReportSubscriptionId(): string;
}
