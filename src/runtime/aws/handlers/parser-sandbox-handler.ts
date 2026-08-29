/** Real handler for the isolated PDF parser sandbox (M6 design §3.3/blueprint §12.4). No VPC,
 * no DynamoDB, no clean-bucket access - reads only the exact object it's told to, returns only
 * the narrow structural result, never raw content. Invoked synchronously by
 * upload-finalizer-handler via Lambda Invoke.
 *
 * Logging-observability-standard.md audit finding (2026-08-29): this handler used to have ZERO
 * logging/correlation context at all - a real S3 failure here (e.g. IAM drift, throttling)
 * would only surface as the Lambda runtime's own unhandled-exception log, never through
 * SecureLogger/Redactor, and unjoinable to the rest of the request. Fixed: accepts the caller's
 * correlationId (LambdaPdfParser's doc comment) and logs its own outcome through SecureLogger. */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parsePdfStructure } from "../../../workers/parser-sandbox/parser.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";
import type { PdfParseResult } from "../../../modules/document/ports/pdf-parser.js";

const s3Client = new S3Client({});
const logger = new SecureLogger({ baseContext: { service: "parser-sandbox" } });

export interface ParserSandboxInput {
  bucket: string;
  key: string;
  versionId: string;
  /** Optional only for defensive backward compatibility with an in-flight invocation payload
   * built before this field existed — every real caller (LambdaPdfParser) always sends it. */
  correlationId?: string;
}

export async function handler(event: ParserSandboxInput): Promise<PdfParseResult> {
  return runWithContext({ correlationId: event.correlationId ?? "unknown" }, async () => {
    try {
      const result = await s3Client.send(new GetObjectCommand({ Bucket: event.bucket, Key: event.key, VersionId: event.versionId }));
      if (!result.Body) {
        logger.warn("parser-sandbox empty S3 body", { bucket: event.bucket, key: event.key });
        return { outcome: "INVALID_STRUCTURE" };
      }
      const bytes = await result.Body.transformToByteArray();
      const parsed = await parsePdfStructure(bytes);
      logger.info("parser-sandbox outcome", { outcome: parsed.outcome });
      return parsed;
    } catch (err) {
      // Fail closed the SAME way LambdaPdfParser's caller-side FunctionError branch already
      // does (never assume VALID on an unexpected failure) - but now the real cause is at
      // least logged (redacted) instead of only visible as a raw, unstructured Lambda runtime
      // error.
      const appErr = toAppError(err);
      logger.error("parser-sandbox failed", { bucket: event.bucket, key: event.key, errorCode: appErr.code });
      return { outcome: "INVALID_STRUCTURE" };
    }
  });
}
