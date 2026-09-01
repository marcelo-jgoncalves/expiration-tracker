/** Composition root for the document-archive module against real DynamoDB (D-143 Nucleus 1). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbDocumentArchiveStore } from "../../../modules/document-archive/persistence/dynamodb-document-archive-store.js";
import { DocumentArchiveService } from "../../../modules/document-archive/application/document-archive-service.js";
import { UlidIdGenerator } from "../ids.js";

export function buildDocumentArchiveDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbDocumentArchiveStore(client, tableName);
  const ids = new UlidIdGenerator();
  const documentArchive = new DocumentArchiveService({ store, tableName, ids });
  return { store, documentArchive };
}
