/** Composition root for the BFF module against real DynamoDB/KMS/Cognito. */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbIdentityStore } from "../../../modules/identity/persistence/dynamodb-identity-store.js";
import { TenantBootstrapService } from "../../../modules/identity/application/bootstrap-identity.js";
import { UserRepository } from "../../../modules/identity/persistence/user-repository.js";
import { DynamoDbSessionStore } from "../../../modules/bff/persistence/dynamodb-session-store.js";
import { KmsTokenEncryptor, createKmsClient } from "../../../modules/bff/persistence/kms-token-encryptor.js";
import { FetchCognitoOidcClient } from "../../../modules/bff/persistence/fetch-cognito-oidc-client.js";
import { AwsJwtIdTokenVerifier } from "../../../modules/bff/persistence/aws-jwt-id-token-verifier.js";
import { BffAuthService } from "../../../modules/bff/application/bff-auth-service.js";
import { ProxyService, type BackendFetcher } from "../../../modules/bff/application/proxy-service.js";
import { UlidIdGenerator } from "../ids.js";

export interface BffConfig {
  mainTableName: string;
  sessionTableName: string;
  sessionTokenPepper: string;
  kmsKeyId: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoClientSecret: string;
  cognitoDomain: string; // e.g. https://<prefix>.auth.<region>.amazoncognito.com
  authorizeUrl: string; // `${cognitoDomain}/oauth2/authorize`
  redirectUri: string; // e.g. https://app.example.com/bff/callback
  apiBaseUrl: string; // the real, JWT-authorizer-protected API's base URL
}

const fetchBackend: BackendFetcher = {
  async fetch(input) {
    const res = await fetch(input.url, { method: input.method, headers: input.headers, body: input.body });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { statusCode: res.status, headers, body: await res.text() };
  },
};

export function buildBffDeps(mainClient: DynamoDBDocumentClient, sessionClient: DynamoDBDocumentClient, config: BffConfig) {
  const identityStore = new DynamoDbIdentityStore(mainClient, config.mainTableName);
  const bootstrap = new TenantBootstrapService(identityStore, config.mainTableName);
  const users = new UserRepository(identityStore);

  const sessionStore = new DynamoDbSessionStore(sessionClient, config.sessionTableName);
  const tokenEncryptor = new KmsTokenEncryptor(createKmsClient(), config.kmsKeyId);
  const cognitoClient = new FetchCognitoOidcClient(config.cognitoDomain, config.cognitoClientId, config.cognitoClientSecret);
  const idTokenVerifier = new AwsJwtIdTokenVerifier(config.cognitoUserPoolId, config.cognitoClientId);
  const ids = new UlidIdGenerator();

  const auth = new BffAuthService({
    sessionStore,
    cognitoClient,
    idTokenVerifier,
    tokenEncryptor,
    bootstrap,
    users,
    pepper: config.sessionTokenPepper,
    redirectUri: config.redirectUri,
    authorizeUrl: config.authorizeUrl,
    clientId: config.cognitoClientId,
    now: () => new Date().toISOString(),
    newUserId: () => ids.newUserId(),
    newDeviceId: () => ids.newDeviceId(),
  });
  const proxy = new ProxyService(fetchBackend, config.apiBaseUrl);

  return { auth, proxy };
}
