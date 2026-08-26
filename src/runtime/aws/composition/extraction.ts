/** Composition root for the extraction module against real DynamoDB/Step Functions (M7). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbDocumentStore } from "../../../modules/document/persistence/dynamodb-document-store.js";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { DynamoDbExtractionRunStore } from "../../../modules/extraction/persistence/dynamodb-extraction-run-store.js";
import { DynamoDbExtractedFieldStore } from "../../../modules/extraction/persistence/dynamodb-extracted-field-store.js";
import { SfnExtractionExecutionStarter, createSfnClient } from "../../../modules/extraction/persistence/sfn-extraction-execution-starter.js";
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
