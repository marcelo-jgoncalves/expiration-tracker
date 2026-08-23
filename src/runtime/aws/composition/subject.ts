/** Composition root for the subject module against real DynamoDB (M9). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbSubjectStore } from "../../../modules/subject/persistence/dynamodb-subject-store.js";
import { SubjectService } from "../../../modules/subject/application/subject-service.js";
import { RequirementService } from "../../../modules/subject/application/requirement-service.js";
import type { ExpirationItemLookup } from "../../../modules/subject/ports/expiration-item-lookup.js";
import { DynamoDbExpirationStore } from "../../../modules/expiration/persistence/dynamodb-expiration-store.js";
import { itemKey } from "../../../modules/expiration/domain/expiration-item.js";
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
