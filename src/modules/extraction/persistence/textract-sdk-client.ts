/** Real adapter for the `TextractClient` port over `@aws-sdk/client-textract`. Only this file
 * imports the Textract SDK — every caller above it (start-ocr.ts/complete-ocr.ts) only sees the
 * narrow port shape. */
import {
  TextractClient as AwsTextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from "@aws-sdk/client-textract";
import type {
  TextractClient,
  StartDocumentTextDetectionInput,
  StartDocumentTextDetectionResult,
  GetDocumentTextDetectionPage,
  TextractJobStatusResult,
} from "../ports/textract-client.js";

function mapStatus(status: string | undefined): TextractJobStatusResult {
  if (status === "SUCCEEDED" || status === "FAILED" || status === "PARTIAL_SUCCESS") return status;
  return "IN_PROGRESS";
}

export class TextractSdkClient implements TextractClient {
  constructor(private readonly client: AwsTextractClient) {}

  async startDocumentTextDetection(input: StartDocumentTextDetectionInput): Promise<StartDocumentTextDetectionResult> {
    const result = await this.client.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: input.bucket, Name: input.key } },
        ClientRequestToken: input.clientRequestToken,
        JobTag: input.jobTag,
        NotificationChannel: { SNSTopicArn: input.snsTopicArn, RoleArn: input.snsRoleArn },
      }),
    );
    if (!result.JobId) {
      throw new Error("Textract StartDocumentTextDetection returned no JobId.");
    }
    return { jobId: result.JobId };
  }

  async getDocumentTextDetectionPage(jobId: string, nextToken?: string): Promise<GetDocumentTextDetectionPage> {
    const result = await this.client.send(new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken }));
    return {
      status: mapStatus(result.JobStatus),
      blocks: (result.Blocks ?? []) as Record<string, unknown>[],
      nextToken: result.NextToken,
      warnings: result.Warnings?.map((w) => w.ErrorCode ?? "UNKNOWN_WARNING"),
    };
  }
}

export function createTextractClient(): AwsTextractClient {
  return new AwsTextractClient({});
}
