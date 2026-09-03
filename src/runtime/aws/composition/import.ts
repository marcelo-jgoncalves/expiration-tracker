/** Composition root for the import module against real DynamoDB/S3 (M11, D-042). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDbImportStore } from "../../../modules/import/persistence/dynamodb-import-store.js";
import { S3ImportObjectStore } from "../../../modules/import/persistence/s3-import-object-store.js";
import { ImportService } from "../../../modules/import/application/import-service.js";
// M11 reaproveita o signer S3 genérico do módulo document (M6) - não é acoplado à entidade
// Document, só a bucket/key/checksum/content-length (mesmo motivo de subject.ts's reuso dele
// para DocumentSubmission).
import { S3UploadUrlSigner } from "../../../modules/document/persistence/s3-upload-url-signer.js";
import { UlidIdGenerator } from "../ids.js";
import { buildSubjectDeps } from "./subject.js";
import type { TenantQuotaService } from "../../../modules/identity/application/quota.js";

export function buildImportHttpDeps(client: DynamoDBDocumentClient, tableName: string, rawBucket: string, quota: TenantQuotaService) {
  const store = new DynamoDbImportStore(client, tableName);
  const signer = new S3UploadUrlSigner(new S3Client({}));
  const ids = new UlidIdGenerator();
  const imports = new ImportService({ store, tableName, rawBucket, ids, signer, quota });
  return { store, imports };
}

export function buildImportParseWorkerDeps(client: DynamoDBDocumentClient, tableName: string, rawBucket: string, planBucket: string, quota: TenantQuotaService) {
  const store = new DynamoDbImportStore(client, tableName);
  // Fallback fraco de dedup precisa da MESMA SubjectStore de leitura do módulo subject (GSI7)
  // - nunca uma cópia/duplicata, `buildSubjectDeps` já é a fonte única de verdade dela.
  const { store: subjectStore } = buildSubjectDeps(client, tableName);
  const objectStore = new S3ImportObjectStore(new S3Client({}));
  return { store, subjectStore, objectStore, rawBucket, planBucket, quota, tableName, now: () => new Date().toISOString() };
}

export function buildImportCommitWorkerDeps(client: DynamoDBDocumentClient, tableName: string, planBucket: string) {
  const store = new DynamoDbImportStore(client, tableName);
  const objectStore = new S3ImportObjectStore(new S3Client({}));
  // commitImportJob() reaproveita SubjectService.createSubject() INALTERADO (design) - nunca
  // uma segunda implementação de criação de subject só para o worker de import.
  const { subjects } = buildSubjectDeps(client, tableName);
  // D-192 §6 (fatia 8) - Document/Requirement geram documentId/requirementId ANTES da
  // transação de commit via os mesmos planejadores puros que document-archive-service.ts usa;
  // `UlidIdGenerator` já implementa `DocumentArchiveIdGenerator` (mesma instância reaproveitada
  // em toda a composição AWS, nunca um segundo gerador de ids).
  const documentArchiveIds = new UlidIdGenerator();
  return { store, objectStore, planBucket, tableName, subjects, documentArchiveIds, now: () => new Date().toISOString() };
}
