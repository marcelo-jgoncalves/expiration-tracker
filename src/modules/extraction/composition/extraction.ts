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
import type { StartOcrDeps } from "../application/start-ocr.js";
import type { CompleteOcrDeps } from "../application/complete-ocr.js";
import type { RunDeterministicParserDeps } from "../application/run-deterministic-parser.js";

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
