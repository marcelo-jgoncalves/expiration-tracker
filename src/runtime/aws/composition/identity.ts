/** Composition root for the identity module against real DynamoDB (M3.5). */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbIdentityStore } from "../../../modules/identity/persistence/dynamodb-identity-store.js";
import { IdentityMappingRepository } from "../../../modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../modules/identity/persistence/user-repository.js";
import { RequestContextResolver } from "../../../modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../../modules/identity/application/quota.js";
import { ProfileService } from "../../../modules/identity/application/profile-service.js";
import { UlidIdGenerator } from "../ids.js";

export function buildIdentityDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbIdentityStore(client, tableName);
  const ids = new UlidIdGenerator();
  const identityMappings = new IdentityMappingRepository(store);
  const users = new UserRepository(store);
  const resolver = new RequestContextResolver(identityMappings, users, ids, store, tableName);
  const quota = new TenantQuotaService(store);
  return { store, resolver, quota };
}

export function buildProfileHttpDeps(client: DynamoDBDocumentClient, tableName: string) {
  const store = new DynamoDbIdentityStore(client, tableName);
  const users = new UserRepository(store);
  const profiles = new ProfileService({ users });
  return { profiles };
}
