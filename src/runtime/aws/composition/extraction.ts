/** Composition root for the extraction module against real DynamoDB/Step Functions (M7). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbDocumentStore } from "../../../modules/document/persistence/dynamodb-document-store.js";
import { DynamoDbExtractionRunStore } from "../../../modules/extraction/persistence/dynamodb-extraction-run-store.js";
import { SfnExtractionExecutionStarter, createSfnClient } from "../../../modules/extraction/persistence/sfn-extraction-execution-starter.js";

export function buildExtractionStarterWorkerDeps(client: DynamoDBDocumentClient, tableName: string, stateMachineArn: string) {
  // DynamoDbDocumentStore already implements DocumentReader's narrow surface (structural
  // typing) - no separate adapter needed just to read a Document.
  const documents = new DynamoDbDocumentStore(client, tableName);
  const runs = new DynamoDbExtractionRunStore(client, tableName);
  const executions = new SfnExtractionExecutionStarter(createSfnClient(), stateMachineArn);
  return { documents, runs, executions };
}
