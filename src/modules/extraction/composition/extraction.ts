/** Composition root for `TextractTaskHandler` (M7 items 3/4) against real AWS adapters —
 * DynamoDB, S3, Textract, Step Functions, KMS, AppConfigData. Mirrors
 * `src/runtime/aws/composition/extraction.ts` (item 2's `buildExtractionStarterWorkerDeps`)
 * pattern, kept in `src/modules/extraction/composition/` rather than `src/runtime/aws/
 * composition/` because it wires only extraction-module ports/adapters, no cross-module
 * composition (unlike item 2's, which also needed `DocumentReader`). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { S3Client } from "@aws-sdk/client-s3";
import type { SFNClient } from "@aws-sdk/client-sfn";
import { KMSClient } from "@aws-sdk/client-kms";
import { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { TextractClient as AwsTextractClient } from "@aws-sdk/client-textract";
import { DynamoDbIdentityStore } from "../../identity/persistence/dynamodb-identity-store.js";
import { TenantQuotaService } from "../../identity/application/quota.js";
import { DynamoDbTextractJobStore } from "../persistence/dynamodb-textract-job-store.js";
import { TextractSdkClient } from "../persistence/textract-sdk-client.js";
import { S3OcrArtifactStore } from "../persistence/s3-ocr-artifact-store.js";
import { KmsTaskTokenEncryptor } from "../persistence/kms-task-token-encryptor.js";
import { SfnTaskTokenSender } from "../persistence/sfn-task-token-sender.js";
import { AppConfigFeatureFlagsReader } from "../persistence/appconfig-feature-flags-reader.js";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { StartOcrDeps } from "../application/start-ocr.js";
import type { CompleteOcrDeps } from "../application/complete-ocr.js";
import type { RunDeterministicParserDeps } from "../application/run-deterministic-parser.js";
import type { RunBedrockExtractionDeps } from "../application/run-bedrock-extraction.js";
import { BedrockRuntimeConverseClient } from "../persistence/bedrock-runtime-client.js";
import { DynamoDbDocumentStore } from "../../document/persistence/dynamodb-document-store.js";
import { DynamoDbExtractionRunStore } from "../persistence/dynamodb-extraction-run-store.js";
import { DynamoDbExtractedFieldStore } from "../persistence/dynamodb-extracted-field-store.js";
import type { RunExtractionValidationDeps } from "../application/run-extraction-validation.js";

export interface TextractTaskWorkerConfig {
  tableName: string;
  extractionTransientBucket: string;
  taskTokenKmsKeyId: string;
  textractSnsTopicArn: string;
  textractSnsRoleArn: string;
  appConfig: { applicationId: string; environmentId: string; configurationProfileId: string };
}

export interface TextractTaskWorkerDeps {
  startOcr: StartOcrDeps;
  completeOcr: CompleteOcrDeps;
}

export function buildTextractTaskWorkerDeps(
  clients: {
    dynamo: DynamoDBDocumentClient;
    s3: S3Client;
    sfn: SFNClient;
    kms: KMSClient;
    appConfigData: AppConfigDataClient;
    textract: AwsTextractClient;
  },
  config: TextractTaskWorkerConfig,
): TextractTaskWorkerDeps {
  const identityStore = new DynamoDbIdentityStore(clients.dynamo, config.tableName);
  const quota = new TenantQuotaService(identityStore);
  const jobs = new DynamoDbTextractJobStore(clients.dynamo, config.tableName);
  const textract = new TextractSdkClient(clients.textract);
  const artifacts = new S3OcrArtifactStore(clients.s3, config.extractionTransientBucket);
  const tokenEncryptor = new KmsTaskTokenEncryptor(clients.kms, config.taskTokenKmsKeyId);
  const sender = new SfnTaskTokenSender(clients.sfn);
  const featureFlags = new AppConfigFeatureFlagsReader(clients.appConfigData, config.appConfig);

  return {
    startOcr: {
      featureFlags,
      quota,
      textract,
      jobs,
      tokenEncryptor,
      snsTopicArn: config.textractSnsTopicArn,
      snsRoleArn: config.textractSnsRoleArn,
    },
    completeOcr: {
      textract,
      jobs,
      artifacts,
      tokenEncryptor,
      sender,
    },
  };
}

export function createRealTextractTaskWorkerClients() {
  return {
    kms: new KMSClient({}),
    appConfigData: new AppConfigDataClient({}),
    textract: new AwsTextractClient({}),
  };
}

/** Composition root for `PdfParserTaskHandler` (M7 item 5, D-035 §1.3) - a much narrower
 * dependency set than `TextractTaskHandler`'s: no DynamoDB, no Textract, no KMS, no Step
 * Functions client (the ASL's `RunDeterministicParser` is a plain synchronous
 * `lambda:invoke`, no task token at all). Only S3 (read the OCR artifact) and AppConfig (the
 * `AI_EXTRACTION` kill switch). */
export interface PdfParserTaskWorkerConfig {
  extractionTransientBucket: string;
  appConfig: { applicationId: string; environmentId: string; configurationProfileId: string };
}

export interface PdfParserTaskWorkerDeps {
  runDeterministicParser: RunDeterministicParserDeps;
}

export function buildPdfParserTaskWorkerDeps(
  clients: { s3: S3Client; appConfigData: AppConfigDataClient },
  config: PdfParserTaskWorkerConfig,
): PdfParserTaskWorkerDeps {
  const artifacts = new S3OcrArtifactStore(clients.s3, config.extractionTransientBucket);
  const featureFlags = new AppConfigFeatureFlagsReader(clients.appConfigData, config.appConfig);

  return {
    runDeterministicParser: { artifacts, featureFlags },
  };
}

export function createRealPdfParserTaskWorkerClients() {
  return {
    appConfigData: new AppConfigDataClient({}),
  };
}

/** Composition root for `BedrockExtractionTaskHandler` (M7 item 6, D-035 §1.9/§1.11) - like
 * item 5, a plain synchronous `lambda:invoke` with no task token, but needs DynamoDB (quota,
 * via `TenantQuotaService`/`DynamoDbIdentityStore`, same as `TextractTaskHandler`), S3 (read the
 * OCR artifact, same `S3OcrArtifactStore` as item 5), AppConfig (`AI_EXTRACTION` re-check), and
 * `BedrockRuntimeClient`. No KMS, no Step Functions client, no Textract client. */
export interface BedrockExtractionTaskWorkerConfig {
  tableName: string;
  extractionTransientBucket: string;
  bedrockModelId: string;
  appConfig: { applicationId: string; environmentId: string; configurationProfileId: string };
}

export interface BedrockExtractionTaskWorkerDeps {
  runBedrockExtraction: RunBedrockExtractionDeps;
}

export function buildBedrockExtractionTaskWorkerDeps(
  clients: { dynamo: DynamoDBDocumentClient; s3: S3Client; appConfigData: AppConfigDataClient; bedrockRuntime: BedrockRuntimeClient },
  config: BedrockExtractionTaskWorkerConfig,
): BedrockExtractionTaskWorkerDeps {
  const identityStore = new DynamoDbIdentityStore(clients.dynamo, config.tableName);
  const quota = new TenantQuotaService(identityStore);
  const artifacts = new S3OcrArtifactStore(clients.s3, config.extractionTransientBucket);
  const featureFlags = new AppConfigFeatureFlagsReader(clients.appConfigData, config.appConfig);
  const bedrock = new BedrockRuntimeConverseClient(clients.bedrockRuntime, artifacts, config.bedrockModelId);

  return {
    runBedrockExtraction: { featureFlags, quota, bedrock },
  };
}

/** Composition root for `ExtractionValidationTaskHandler` (M7 item 7, D-035 §2/§3) - the
 * narrowest dependency set of the four extraction Lambdas: only DynamoDB (reads the `Document`
 * discard-guard, writes `ExtractedField`/`ExtractionRun`) and S3 (deletes the transient OCR
 * artifact at the run's terminal step). No Textract, no Bedrock, no KMS, no Step Functions
 * client, no AppConfig (the kill switches were already read/enforced by items 4/5/6 upstream -
 * this handler only ever validates/persists what they already decided). */
export interface ExtractionValidationTaskWorkerConfig {
  tableName: string;
  extractionTransientBucket: string;
}

export interface ExtractionValidationTaskWorkerDeps {
  runExtractionValidation: RunExtractionValidationDeps;
}

export function buildExtractionValidationTaskWorkerDeps(
  clients: { dynamo: DynamoDBDocumentClient; s3: S3Client },
  config: ExtractionValidationTaskWorkerConfig,
): ExtractionValidationTaskWorkerDeps {
  const documents = new DynamoDbDocumentStore(clients.dynamo, config.tableName);
  const runs = new DynamoDbExtractionRunStore(clients.dynamo, config.tableName);
  const fields = new DynamoDbExtractedFieldStore(clients.dynamo, config.tableName);
  const artifacts = new S3OcrArtifactStore(clients.s3, config.extractionTransientBucket);

  return {
    runExtractionValidation: { documents, runs, fields, artifacts },
  };
}

export function createRealBedrockExtractionTaskWorkerClients(region: string) {
  return {
    appConfigData: new AppConfigDataClient({}),
    // Region is explicitly configurable (design §4 - model/region selection is a pre-production
    // decision, deliberately never hardcoded here) - see BEDROCK_REGION/BEDROCK_MODEL_ID env
    // vars in bedrock-extraction-task-handler.ts and their obviously-placeholder Terraform
    // defaults.
    bedrockRuntime: new BedrockRuntimeClient({ region }),
  };
}
