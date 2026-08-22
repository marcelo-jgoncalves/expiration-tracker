/** Real adapter for PdfParser (M6 design §3.3): synchronously invokes the isolated
 * parser-sandbox-handler Lambda. Passes only the object reference — never the object bytes
 * over this call, the sandbox reads directly from S3 with its own minimal IAM. */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { PdfParseResult, PdfParser } from "../ports/pdf-parser.js";

export class LambdaPdfParser implements PdfParser {
  constructor(
    private readonly client: LambdaClient,
    private readonly functionName: string,
  ) {}

  async parse(ref: { bucket: string; key: string; versionId: string }): Promise<PdfParseResult> {
    const result = await this.client.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(ref)),
      }),
    );
    if (result.FunctionError) {
      // The sandbox itself failing (timeout, OOM, unhandled exception) is not the same as it
      // successfully classifying the document as invalid - fail closed, never assume VALID.
      return { outcome: "INVALID_STRUCTURE" };
    }
    const payload = result.Payload ? JSON.parse(Buffer.from(result.Payload).toString("utf-8")) : {};
    return payload as PdfParseResult;
  }
}

export function createLambdaClient(): LambdaClient {
  return new LambdaClient({});
}
