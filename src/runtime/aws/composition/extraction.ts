/** Composition root for the extraction module against real DynamoDB/Step Functions (M7). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { DynamoDbDocumentStore } from "../../../modules/document/persistence/dynamodb-document-store.js";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { DynamoDbExtractionRunStore } from "../../../modules/extraction/persistence/dynamodb-extraction-run-store.js";
import { DynamoDbExtractedFieldStore } from "../../../modules/extraction/persistence/dynamodb-extracted-field-store.js";
import { SfnExtractionExecutionStarter, createSfnClient } from "../../../modules/extraction/persistence/sfn-extraction-execution-starter.js";
import { AppConfigFeatureFlagsReader } from "../../../modules/extraction/persistence/appconfig-feature-flags-reader.js";
import { DynamoDbDocumentArchiveStore } from "../../../modules/document-archive/persistence/dynamodb-document-archive-store.js";
import type { StartExtractionRunForDocumentArchiveDeps } from "../../../modules/extraction/application/start-extraction-run-for-document-archive.js";
import { IdempotencyStore, transitionIdempotencyStatus, type DynamoLike } from "../../../shared/idempotency/idempotency.js";
import type { ConfirmRejectFieldDeps } from "../../../modules/extraction/application/confirm-reject-field.js";

export function buildExtractionStarterWorkerDeps(client: DynamoDBDocumentClient, tableName: string, stateMachineArn: string) {
  // DynamoDbDocumentStore already implements DocumentReader's narrow surface (structural
  // typing) - no separate adapter needed just to read a Document.
  const documents = new DynamoDbDocumentStore(client, tableName);
  const runs = new DynamoDbExtractionRunStore(client, tableName);
  const executions = new SfnExtractionExecutionStarter(createSfnClient(), stateMachineArn);
  return { documents, runs, executions };
}

/** D-193 item 3/9 ("Starter") — the `document-archive`-flavored branch of
 * `extraction-starter-handler.ts`. Slice 3 wires the real `ExtractionExecutionStarter` now that
 * `run-extraction-validation.ts`'s `commitOrDiscard()` understands `document-archive` documents
 * (see `start-extraction-run-for-document-archive.ts`'s own doc comment, "RESOLVED GAP"). Item
 * 8/9 adds the `featureFlags` reader (STARTER gate, `EXTRACTION_DOCUMENT_ARCHIVE_TRIGGER_ENABLED`)
 * - same `AppConfigFeatureFlagsReader` adapter every other AppConfig-gated worker in this repo
 * already uses. */
export function buildExtractionStarterWorkerDepsForDocumentArchive(
  client: DynamoDBDocumentClient,
  tableName: string,
  stateMachineArn: string,
  appConfigData: AppConfigDataClient,
  appConfig: { applicationId: string; environmentId: string; configurationProfileId: string },
): StartExtractionRunForDocumentArchiveDeps {
  const archive = new DynamoDbDocumentArchiveStore(client, tableName);
  const runs = new DynamoDbExtractionRunStore(client, tableName);
  const executions = new SfnExtractionExecutionStarter(createSfnClient(), stateMachineArn);
  const featureFlags = new AppConfigFeatureFlagsReader(appConfigData, appConfig);
  return { archive, runs, executions, featureFlags };
}

/** M7 item 8 (§1.7) — the confirm/reject field HTTP routes. `DynamoDbExpirationStore` already
 * implements `EntityReader`'s narrow `get()` surface (structural typing, same reuse pattern as
 * `DocumentReader` above) AND `IdempotencyStore`'s full `DynamoLike` backing surface (get/
 * putIfAbsent/update/transactWrite) - the exact same adapter shape ExpirationService itself
 * builds around its own store (expiration-service.ts), reused here rather than re-declared. */
export function buildFieldConfirmationDeps(client: DynamoDBDocumentClient, tableName: string): ConfirmRejectFieldDeps {
  const documents = new DynamoDbDocumentStore(client, tableName);
  const items = new DynamoDbExpirationStore(client, tableName);
  const runs = new DynamoDbExtractionRunStore(client, tableName);
  const fields = new DynamoDbExtractedFieldStore(client, tableName);

  const idempotencyAdapter: DynamoLike = {
    putIfAbsent: async (item) => ((await items.putIfAbsent(item)) ? "PUT" : "ALREADY_EXISTS"),
    get: (key) => items.get(key),
    update: (item) => items.update(item),
    transitionIfStatus: (item, expectedStatus) => transitionIdempotencyStatus(items, tableName, item, expectedStatus),
  };
  const idempotency = new IdempotencyStore(idempotencyAdapter, tableName);

  return { documents, items, runs, fields, idempotency, now: () => new Date().toISOString() };
}
