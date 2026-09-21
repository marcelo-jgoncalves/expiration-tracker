/**
 * Cognito OAuth2/OIDC HTTP surface (Hosted UI's `/oauth2/token` and `/oauth2/revoke`
 * endpoints) - Authorization Code + PKCE only (D-053: implicit/hybrid never considered;
 * Cognito app client already has `allowed_oauth_flows=["code"]`,
 * `infra/modules/cognito/main.tf`). SDK-agnostic: the real adapter uses `fetch`, the test
 * double is a plain in-memory object - no @aws-sdk client needed for OAuth2 REST calls.
 */
export interface CognitoTokenResponse {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export type CognitoRefreshOutcome =
  | { kind: "SUCCESS"; response: CognitoTokenResponse }
  | { kind: "INVALID_GRANT" }
  | { kind: "TRANSIENT_FAILURE"; cause: unknown }
  | { kind: "UNKNOWN_OUTCOME" };

export interface CognitoOidcClient {
  exchangeAuthorizationCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<CognitoTokenResponse>;
  refreshAccessToken(input: { refreshToken: string }): Promise<CognitoRefreshOutcome>;
  /** Best-effort by design (D-054) - callers must never let a rejection here block logout. */
  revokeRefreshToken(input: { refreshToken: string }): Promise<void>;
}

/**
 * ID token signature/issuer/audience verification (aws-jwt-verify, already a dependency
 * reserved for exactly this - never used anywhere before the BFF because the API Gateway's
 * native JWT authorizer only ever validates the ACCESS token on resource routes, never the ID
 * token, which only exists during this callback step). A separate port from
 * CognitoOidcClient so application-layer tests stay hermetic (no real JWKS fetch).
 */
export interface IdTokenVerifier {
  /** Throws on any failure: bad signature, wrong issuer/audience, expired, or nonce mismatch.
   * `name` (#15, 2026-09-21) requires the `profile` OIDC scope (already in Cognito's
   * `allowed_oauth_scopes`, `infra/modules/cognito/main.tf` - only the requested `scope` string
   * in `bff-auth-service.ts` needed to catch up) - absent when the identity provider never sent
   * a `name` claim, same "optional, never guessed" treatment `email` already gets. */
  verify(idToken: string, expectedNonce: string): Promise<{ subject: string; email?: string; name?: string }>;
}
