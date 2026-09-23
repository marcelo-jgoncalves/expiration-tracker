/**
 * Direct Cognito authentication (D-3xx, reversal of D-320's Managed Login decision) - the
 * `InitiateAuth`/`SignUp`/`ForgotPassword`/`ConfirmForgotPassword` family of Cognito Identity
 * Provider APIs, called server-side from the BFF (never from the browser - the app client has
 * `generate_secret = true`, infra/modules/cognito/main.tf, so every call here needs a
 * `SECRET_HASH` computed from a secret that must never reach the client).
 *
 * Distinct from `CognitoOidcClient` (cognito-oidc-client.ts), which stays in place unchanged
 * and still serves two real callers: `/oauth2/token`'s refresh_token grant (BffAuthService.
 * refresh(), untouched by this decision) and the dormant authorization-code+PKCE fallback
 * (handleLogin/handleCallback, kept but no longer linked from the frontend - see D-3xx).
 *
 * AuthFlow choice: `USER_PASSWORD_AUTH`, not `USER_SRP_AUTH` - the credential still travels
 * over TLS to a first-party AWS API the same way a Hosted UI form post would, and Cognito
 * itself documents USER_PASSWORD_AUTH as a supported, non-deprecated flow. USER_SRP_AUTH would
 * require either reimplementing the SRP client math by hand (explicitly out of scope - "não
 * reinventar criptografia") or pulling in `amazon-cognito-identity-js`, a browser-oriented
 * client library never designed to run against a confidential (secret-bearing) app client from
 * a server context - not a better fit here than the plain, officially-documented API call this
 * file makes directly via `@aws-sdk/client-cognito-identity-provider` (already a dependency).
 */
export interface CognitoAuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/**
 * `INVALID_CREDENTIALS` deliberately collapses "wrong password" and "no such user" into one
 * outcome - `prevent_user_existence_errors = "ENABLED"` on the app client (already set,
 * infra/modules/cognito/main.tf) makes Cognito itself return the same NotAuthorizedException
 * for both, so this port is not inventing that anti-enumeration behavior, only preserving it
 * (D-3xx decision 3).
 *
 * `UNSUPPORTED_CHALLENGE` covers any ChallengeName InitiateAuth could return instead of a
 * finished AuthenticationResult (SOFTWARE_TOKEN_MFA, NEW_PASSWORD_REQUIRED, ...) - none is
 * reachable today (no MFA enrollment UI ever existed, `mfa_configuration = OPTIONAL` has zero
 * enrolled users; no admin-created user with a temporary password path exists either, only
 * self-service SignUp below) - failing closed here is a deliberate, named gap for a case that
 * cannot currently occur, never a silent mishandling.
 */
export type CognitoAuthenticateOutcome =
  | { kind: "SUCCESS"; tokens: CognitoAuthTokens }
  | { kind: "INVALID_CREDENTIALS" }
  | { kind: "USER_NOT_CONFIRMED" }
  | { kind: "PASSWORD_RESET_REQUIRED" }
  | { kind: "UNSUPPORTED_CHALLENGE"; challengeName: string }
  | { kind: "TRANSIENT_FAILURE"; cause: unknown }
  | { kind: "UNKNOWN_OUTCOME" };

export type CognitoSignUpOutcome =
  | { kind: "CONFIRMATION_REQUIRED" }
  | { kind: "EMAIL_ALREADY_REGISTERED" }
  | { kind: "INVALID_PASSWORD" }
  | { kind: "TRANSIENT_FAILURE"; cause: unknown }
  | { kind: "UNKNOWN_OUTCOME" };

export type CognitoConfirmSignUpOutcome =
  | { kind: "SUCCESS" }
  | { kind: "INVALID_CODE_OR_EXPIRED" }
  | { kind: "ALREADY_CONFIRMED" }
  | { kind: "TRANSIENT_FAILURE"; cause: unknown }
  | { kind: "UNKNOWN_OUTCOME" };

export type CognitoResendConfirmationOutcome =
  | { kind: "SENT" }
  | { kind: "ALREADY_CONFIRMED" }
  | { kind: "TRANSIENT_FAILURE"; cause: unknown }
  | { kind: "UNKNOWN_OUTCOME" };

/** Always `SUCCESS`-shaped for a genuinely unknown/nonexistent user too (Cognito's own
 * anti-enumeration posture under `prevent_user_existence_errors = "ENABLED"` - see D-3xx
 * decision 3) - only a real transport/unknown failure ever produces a different outcome here. */
export type CognitoForgotPasswordOutcome = { kind: "SUCCESS" } | { kind: "TRANSIENT_FAILURE"; cause: unknown } | { kind: "UNKNOWN_OUTCOME" };

export type CognitoConfirmForgotPasswordOutcome =
  | { kind: "SUCCESS" }
  | { kind: "INVALID_CODE_OR_EXPIRED" }
  | { kind: "INVALID_PASSWORD" }
  | { kind: "TRANSIENT_FAILURE"; cause: unknown }
  | { kind: "UNKNOWN_OUTCOME" };

export interface CognitoAuthClient {
  authenticateWithPassword(input: { username: string; password: string }): Promise<CognitoAuthenticateOutcome>;
  signUp(input: { username: string; password: string; name: string }): Promise<CognitoSignUpOutcome>;
  confirmSignUp(input: { username: string; confirmationCode: string }): Promise<CognitoConfirmSignUpOutcome>;
  resendConfirmationCode(input: { username: string }): Promise<CognitoResendConfirmationOutcome>;
  forgotPassword(input: { username: string }): Promise<CognitoForgotPasswordOutcome>;
  confirmForgotPassword(input: { username: string; confirmationCode: string; newPassword: string }): Promise<CognitoConfirmForgotPasswordOutcome>;
}
