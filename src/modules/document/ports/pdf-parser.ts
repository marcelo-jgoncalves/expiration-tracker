/** PDF structural-validation port — M6 design §3.3. The real adapter invokes the isolated
 * parser-sandbox-handler Lambda (no VPC, no DynamoDB, no clean-bucket access, hard resource
 * limits) and only ever returns this narrow structural result — never extracted text, raw
 * content, or a stack trace, per the design's explicit "nunca devolve texto extraído... ao
 * fluxo de negócio". */
export type PdfParseOutcome = "VALID" | "INVALID_STRUCTURE" | "LIMIT_EXCEEDED" | "UNSUPPORTED_FORMAT";

export interface PdfParseResult {
  outcome: PdfParseOutcome;
  pageCount?: number;
}

export interface PdfParser {
  parse(ref: { bucket: string; key: string; versionId: string }): Promise<PdfParseResult>;
}
