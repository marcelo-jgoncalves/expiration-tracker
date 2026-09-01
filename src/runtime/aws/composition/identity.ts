/** Composition root for the identity module against real DynamoDB (M3.5). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbIdentityStore } from "../../../modules/identity/persistence/dynamodb-identity-store.js";
import { GlobalUserRepository } from "../../../modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver } from "../../../modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../../modules/identity/application/quota.js";
import { DynamoDbOrganizationStore } from "../../../modules/organization/persistence/dynamodb-organization-store.js";
import { UlidIdGenerator } from "../ids.js";

export function buildIdentityDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbIdentityStore(client, tableName);
  const ids = new UlidIdGenerator();
  const globalUsers = new GlobalUserRepository(store);
  const organizations = new DynamoDbOrganizationStore(client, tableName);
  const resolver = new RequestContextResolver(globalUsers, organizations, ids, store, tableName);
  const quota = new TenantQuotaService(store, tableName);
  return { store, resolver, quota };
}
