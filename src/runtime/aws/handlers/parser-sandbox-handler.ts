/** Real handler for the isolated PDF parser sandbox (M6 design §3.3/blueprint §12.4). No VPC,
 * no DynamoDB, no clean-bucket access - reads only the exact object it's told to, returns only
 * the narrow structural result, never raw content. Invoked synchronously by
 * upload-finalizer-handler via Lambda Invoke. */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parsePdfStructure } from "../../../workers/parser-sandbox/parser.js";
import type { PdfParseResult } from "../../../modules/document/ports/pdf-parser.js";

const s3Client = new S3Client({});

export interface ParserSandboxInput {
  bucket: string;
  key: string;
  versionId: string;
}

export async function handler(event: ParserSandboxInput): Promise<PdfParseResult> {
  const result = await s3Client.send(new GetObjectCommand({ Bucket: event.bucket, Key: event.key, VersionId: event.versionId }));
  if (!result.Body) {
    return { outcome: "INVALID_STRUCTURE" };
  }
  const bytes = await result.Body.transformToByteArray();
  return parsePdfStructure(bytes);
}
