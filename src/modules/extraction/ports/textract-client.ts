/** Textract surface `TextractTaskHandler` needs — narrow port, no `@aws-sdk/client-textract`
 * import outside the adapter (same discipline as every other AWS-facing port in this repo). */

export interface StartDocumentTextDetectionInput {
  bucket: string;
  key: string;
  clientRequestToken: string;
  /** Opaque identifier only (design §1.2: "JobTag só com identificador opaco") — never PII,
   * never the raw tenantId/documentId concatenation a log scrape could correlate. */
  jobTag: string;
  snsTopicArn: string;
  snsRoleArn: string;
}

export interface StartDocumentTextDetectionResult {
  jobId: string;
}

export type TextractBlock = Record<string, unknown>;

export type TextractJobStatusResult = "SUCCEEDED" | "FAILED" | "PARTIAL_SUCCESS" | "IN_PROGRESS";

export interface GetDocumentTextDetectionPage {
  status: TextractJobStatusResult;
  blocks: readonly TextractBlock[];
  nextToken?: string;
  warnings?: readonly string[];
}

export interface TextractClient {
  startDocumentTextDetection(input: StartDocumentTextDetectionInput): Promise<StartDocumentTextDetectionResult>;

  /** One page of a (possibly paginated) `GetDocumentTextDetection` result. Caller loops on
   * `nextToken` until absent. */
  getDocumentTextDetectionPage(jobId: string, nextToken?: string): Promise<GetDocumentTextDetectionPage>;
}
