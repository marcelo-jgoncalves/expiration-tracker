/** Composition root for the subject module against real DynamoDB (M9/M10). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDbSubjectStore } from "../../../modules/subject/persistence/dynamodb-subject-store.js";
import { SubjectService } from "../../../modules/subject/application/subject-service.js";
import { RequirementService } from "../../../modules/subject/application/requirement-service.js";
import { DocumentRequestService } from "../../../modules/subject/application/document-request-service.js";
import { GuestSubmissionService } from "../../../modules/subject/application/guest-submission-service.js";
import { GuestRateLimiter } from "../../../modules/subject/application/guest-rate-limiter.js";
import type { ExpirationItemLookup } from "../../../modules/subject/ports/expiration-item-lookup.js";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { itemKey } from "../../../modules/expiration/domain/expiration-item.js";
// M10 (D-037): DocumentSubmission reaproveita os adapters S3/Lambda genéricos do módulo
// document (S3DocumentObjectStore, S3UploadUrlSigner, LambdaPdfParser) - nenhum deles é
// acoplado à entidade Document, só a bucket/key/PDF bytes (ver domain/document-submission.ts).
import { S3DocumentObjectStore } from "../../../modules/document/persistence/s3-document-object-store.js";
import { S3UploadUrlSigner } from "../../../modules/document/persistence/s3-upload-url-signer.js";
import { LambdaPdfParser } from "../../../modules/document/persistence/lambda-pdf-parser.js";
import { UlidIdGenerator } from "../ids.js";

/** Adapter somente-leitura: subject nunca importa expiration-store.ts/expiration-service.ts
 * diretamente no código de produção - só aqui, no composition root, onde plugar módulos é
 * o papel esperado (mantém o boundary domain/application dos dois módulos intacto). */
function buildExpirationItemLookup(client: DynamoDBDocumentClient, tableName: string): ExpirationItemLookup {
  const store = new DynamoDbExpirationStore(client, tableName);
  return {
    async itemExists(tenantId: string, itemId: string): Promise<boolean> {
      const item = await store.get<{ PK: string; SK: string; status?: string }>(itemKey(tenantId, itemId));
      return Boolean(item) && item?.status !== "DELETED";
    },
  };
}

export function buildSubjectDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbSubjectStore(client, tableName);
  const ids = new UlidIdGenerator();
  const itemLookup = buildExpirationItemLookup(client, tableName);
  const subjects = new SubjectService({ store, tableName, ids });
  const requirements = new RequirementService({ store, tableName, ids, itemLookup });
  return { store, subjects, requirements };
}

/** M10 (D-037): lado autenticado (criar/consultar DocumentRequest) — mesmo store do resto do
 * módulo subject. `guestTokenPepper` vem de Secrets Manager (env var já resolvida pelo
 * handler), nunca hardcoded aqui. */
export function buildDocumentRequestDeps(client: DynamoDBDocumentClient, tableName: string, guestTokenPepper: string) {
  const store = new DynamoDbSubjectStore(client, tableName);
  const ids = new UlidIdGenerator();
  const requests = new DocumentRequestService({ store, tableName, ids, guestTokenPepper });
  return { store, requests };
}

/** M10 (D-037): lado do convidado (sem conta) — reaproveita os MESMOS adapters S3 genéricos
 * de M6 (nunca uma cópia). */
export function buildGuestSubmissionDeps(client: DynamoDBDocumentClient, tableName: string, quarantineBucket: string, guestTokenPepper: string) {
  const store = new DynamoDbSubjectStore(client, tableName);
  const ids = new UlidIdGenerator();
  const s3Client = new S3Client({});
  const signer = new S3UploadUrlSigner(s3Client);
  const rateLimiter = new GuestRateLimiter(store);
  const guestSubmissions = new GuestSubmissionService({ store, tableName, quarantineBucket, ids, signer, rateLimiter, guestTokenPepper });
  return { store, guestSubmissions };
}

/** M10 (D-037): deps do par de workers de finalização/malware-result de DocumentSubmission -
 * mesmo padrão de buildDocumentWorkerDeps (document.ts), adapters S3/Lambda genéricos
 * reaproveitados sem cópia. */
export function buildSubjectWorkerDeps(client: DynamoDBDocumentClient, tableName: string, cleanBucket: string, parserFunctionName: string) {
  const store = new DynamoDbSubjectStore(client, tableName);
  const objects = new S3DocumentObjectStore(new S3Client({}));
  const parser = new LambdaPdfParser(new LambdaClient({}), parserFunctionName);
  return { store, objects, parser, tableName, cleanBucket };
}
