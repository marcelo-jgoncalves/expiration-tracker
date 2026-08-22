/** Composition root for the document module against real DynamoDB/S3/Lambda (M6). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDbDocumentStore } from "../../../modules/document/persistence/dynamodb-document-store.js";
import { DynamoDbDocumentCandidateSource } from "../../../modules/document/persistence/dynamodb-document-candidate-source.js";
import { S3DocumentObjectStore } from "../../../modules/document/persistence/s3-document-object-store.js";
import { S3UploadUrlSigner } from "../../../modules/document/persistence/s3-upload-url-signer.js";
import { LambdaPdfParser } from "../../../modules/document/persistence/lambda-pdf-parser.js";
import { DocumentService } from "../../../modules/document/application/document-service.js";
import { DocumentDeletionService } from "../../../modules/document/application/document-deletion-service.js";
import { UlidIdGenerator } from "../ids.js";

export function buildDocumentHttpDeps(client: DynamoDBDocumentClient, tableName: string, quarantineBucket: string) {
  const store = new DynamoDbDocumentStore(client, tableName);
  const s3Client = new S3Client({});
  const signer = new S3UploadUrlSigner(s3Client);
  const ids = new UlidIdGenerator();
  const documents = new DocumentService({ store, tableName, quarantineBucket, ids, signer });
  const deletion = new DocumentDeletionService({ store, tableName });
  return { store, documents, deletion };
}

export function buildDocumentWorkerDeps(client: DynamoDBDocumentClient, tableName: string, cleanBucket: string, parserFunctionName: string) {
  const store = new DynamoDbDocumentStore(client, tableName);
  const objects = new S3DocumentObjectStore(new S3Client({}));
  const parser = new LambdaPdfParser(new LambdaClient({}), parserFunctionName);
  return { store, objects, parser, tableName, cleanBucket };
}

export function buildDocumentCandidateSource(client: DynamoDBDocumentClient, tableName: string) {
  return new DynamoDbDocumentCandidateSource(client, tableName);
}
