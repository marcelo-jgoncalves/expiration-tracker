/**
 * Real Lambda for `BedrockExtractionTaskHandler` (M7 item 6, D-035 §1.9/§1.11). Same shape as
 * item 5's `PdfParserTaskHandler` - the ASL's `RunBedrock` state is `arn:aws:states:::lambda:
 * invoke` (NOT `waitForTaskToken`), so there is no task token, no SQS event source, and no
 * `SendTaskSuccess/Failure` call anywhere in this handler. The Lambda's return value IS the Step
 * Functions Task output.
 *
 * `SecureLogger` only - never logs document/OCR text, the Bedrock system/user prompt content, or
 * the model's raw response, per `implementation-blueprint.md` §20.5's telemetry rule (the same
 * rule item 4/5 already followed for OCR text). Only field names, confidence numbers, and
 * identifiers are ever logged.
 */
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { buildBedrockExtractionTaskWorkerDeps, createRealBedrockExtractionTaskWorkerClients } from "../../../modules/extraction/composition/extraction.js";
import { runBedrockExtraction, type RunBedrockExtractionInput, type RunBedrockExtractionOutput } from "../../../modules/extraction/application/run-bedrock-extraction.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const tableName = process.env["TABLE_NAME"];
const extractionTransientBucket = process.env["EXTRACTION_TRANSIENT_BUCKET_NAME"];
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];
// Deliberately placeholder-shaped defaults (design §4: model/region selection is explicitly
// out of scope, blocked only for real production activation, never for dev testability) -
// same discipline as ses_from_address/app_origin elsewhere in this repo's Terraform. Whoever
// picks a real model/region before enabling AI_EXTRACTION in a non-dev environment must set
// both env vars for real; nothing in this handler validates the value is a real, invokable
// model ID beyond what Bedrock itself rejects at call time.
const bedrockModelId = process.env["BEDROCK_MODEL_ID"] ?? "PLACEHOLDER_BEDROCK_MODEL_ID_NOT_SELECTED";
const bedrockRegion = process.env["BEDROCK_REGION"] ?? process.env["AWS_REGION"] ?? "us-east-1";

if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!extractionTransientBucket) throw new Error("EXTRACTION_TRANSIENT_BUCKET_NAME env var is required.");
if (!appConfigApplicationId) throw new Error("APPCONFIG_APPLICATION_ID env var is required.");
if (!appConfigEnvironmentId) throw new Error("APPCONFIG_ENVIRONMENT_ID env var is required.");
if (!appConfigConfigurationProfileId) throw new Error("APPCONFIG_CONFIGURATION_PROFILE_ID env var is required.");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const realClients = createRealBedrockExtractionTaskWorkerClients(bedrockRegion);

const deps = buildBedrockExtractionTaskWorkerDeps(
  { dynamo, s3, appConfigData: realClients.appConfigData, bedrockRuntime: realClients.bedrockRuntime },
  {
    tableName,
    extractionTransientBucket,
    bedrockModelId,
    appConfig: { applicationId: appConfigApplicationId, environmentId: appConfigEnvironmentId, configurationProfileId: appConfigConfigurationProfileId },
  },
);

const logger = new SecureLogger({ baseContext: { service: "bedrock-extraction-task" } });

export async function handler(event: RunBedrockExtractionInput): Promise<RunBedrockExtractionOutput> {
  return runWithContext({ correlationId: randomUUID(), tenantId: event.tenantId }, async () => {
    try {
      const output = await runBedrockExtraction(deps.runBedrockExtraction, event);
      logger.info("bedrock-extraction-task RunBedrock succeeded", {
        documentId: event.documentId,
        runId: event.runId,
        fieldCount: output.bedrockFields.length,
      });
      return output;
    } catch (err) {
      const appErr = toAppError(err);
      // Rethrown as a real Task failure - the ASL's Catch (ErrorEquals: States.ALL) routes to
      // ValidateSchema anyway, degrading to deterministic-only candidates, per design §1.2.
      logger.error("bedrock-extraction-task RunBedrock failed", { documentId: event.documentId, runId: event.runId, errorCode: appErr.code });
      throw appErr;
    }
  });
}
