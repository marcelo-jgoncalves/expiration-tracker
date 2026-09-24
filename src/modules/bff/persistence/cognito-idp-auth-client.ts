/**
 * Real adapter for CognitoAuthClient (D-3xx) - `@aws-sdk/client-cognito-identity-provider`
 * (already a project dependency), never a hand-rolled HTTP call: these are stateful,
 * exception-shaped Cognito APIs (unlike the plain OAuth2 REST endpoints
 * fetch-cognito-oidc-client.ts calls), so the official SDK's typed commands/exceptions are the
 * right tool, not a reason to reimplement anything cryptographic.
 */
import { createHmac } from "node:crypto";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  NotAuthorizedException,
  UserNotFoundException,
  UserNotConfirmedException,
  PasswordResetRequiredException,
  UsernameExistsException,
  InvalidPasswordException,
  InvalidParameterException,
  CodeMismatchException,
  ExpiredCodeException,
} from "@aws-sdk/client-cognito-identity-provider";
import type {
  CognitoAuthClient,
  CognitoAuthenticateOutcome,
  CognitoConfirmForgotPasswordOutcome,
  CognitoConfirmSignUpOutcome,
  CognitoForgotPasswordOutcome,
  CognitoResendConfirmationOutcome,
  CognitoSignUpOutcome,
} from "../ports/cognito-auth-client.js";

/** Cognito's own documented algorithm for a confidential (secret-bearing) app client's
 * SECRET_HASH parameter - HMAC-SHA256(key = client secret, message = username + client id),
 * base64-encoded. Not a custom scheme: this is the exact, publicly documented computation
 * every Cognito SDK/CLI caller with a client secret must perform; `node:crypto`'s HMAC is the
 * same primitive `kms-token-encryptor.ts`/`opaque-token.ts` already lean on elsewhere in this
 * module for HMAC-based work. */
function secretHash(username: string, clientId: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(username + clientId).digest("base64");
}

/**
 * Best-effort match on Cognito's own (undocumented-as-contract) exception message text for "this
 * account is already confirmed" - round-1 Codex finding (`docs/architecture/reviews/
 * d321-direct-auth-adversarial-review/`): `confirmSignUp`/`resendConfirmationCode` used to treat
 * ANY `NotAuthorizedException`/`InvalidParameterException` as ALREADY_CONFIRMED, which could
 * silently report success for an unrelated authorization/parameter failure. Message text is not
 * part of Cognito's documented API contract (only the exception TYPE is), so this is deliberately
 * a narrowing, defense-in-depth check, never the only thing standing between a real failure and a
 * false success - a message that doesn't match falls through to `UNKNOWN_OUTCOME` (mapped to a
 * 503 by `BffAuthService`), never a silently assumed success.
 */
function looksAlreadyConfirmed(message: string | undefined): boolean {
  return /already confirmed|current status is confirmed/i.test(message ?? "");
}

function isTransient(err: unknown): boolean {
  // Anything that isn't one of the specific, expected Cognito exceptions below is treated as
  // transient/unknown rather than silently swallowed - a thrown network error, throttling, or
  // an AWS-side 5xx all fall here.
  return !(
    err instanceof NotAuthorizedException ||
    err instanceof UserNotFoundException ||
    err instanceof UserNotConfirmedException ||
    err instanceof PasswordResetRequiredException ||
    err instanceof UsernameExistsException ||
    err instanceof InvalidPasswordException ||
    err instanceof InvalidParameterException ||
    err instanceof CodeMismatchException ||
    err instanceof ExpiredCodeException
  );
}

export class CognitoIdpAuthClient implements CognitoAuthClient {
  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private hash(username: string): string {
    return secretHash(username, this.clientId, this.clientSecret);
  }

  async authenticateWithPassword(input: { username: string; password: string }): Promise<CognitoAuthenticateOutcome> {
    try {
      const result = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: this.clientId,
          AuthParameters: { USERNAME: input.username, PASSWORD: input.password, SECRET_HASH: this.hash(input.username) },
        }),
      );
      if (result.ChallengeName) {
        return { kind: "UNSUPPORTED_CHALLENGE", challengeName: result.ChallengeName };
      }
      const auth = result.AuthenticationResult;
      if (!auth?.AccessToken || !auth.IdToken || !auth.RefreshToken || auth.ExpiresIn === undefined) {
        return { kind: "UNKNOWN_OUTCOME" };
      }
      return {
        kind: "SUCCESS",
        tokens: { accessToken: auth.AccessToken, idToken: auth.IdToken, refreshToken: auth.RefreshToken, expiresInSeconds: auth.ExpiresIn },
      };
    } catch (err) {
      // NotAuthorizedException and UserNotFoundException are folded into the SAME outcome
      // (INVALID_CREDENTIALS) - Cognito's `prevent_user_existence_errors = "ENABLED"` already
      // makes this the effective behavior in practice (UserNotFoundException should rarely
      // surface at all for InitiateAuth under that setting), but the fold happens here too so
      // this adapter can never accidentally leak the distinction even if that ever changes.
      if (err instanceof NotAuthorizedException || err instanceof UserNotFoundException) return { kind: "INVALID_CREDENTIALS" };
      if (err instanceof UserNotConfirmedException) return { kind: "USER_NOT_CONFIRMED" };
      if (err instanceof PasswordResetRequiredException) return { kind: "PASSWORD_RESET_REQUIRED" };
      if (isTransient(err)) return { kind: "TRANSIENT_FAILURE", cause: err };
      return { kind: "UNKNOWN_OUTCOME" };
    }
  }

  async signUp(input: { username: string; password: string; name: string }): Promise<CognitoSignUpOutcome> {
    try {
      await this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: input.username,
          Password: input.password,
          SecretHash: this.hash(input.username),
          // `name` (standard Cognito attribute, no schema/read_attributes change needed - see
          // infra/modules/cognito/main.tf) rides the ID token's own `name` claim on first login,
          // which `AwsJwtIdTokenVerifier.verify()` already reads generically for every auth path
          // (direct password login included, not just OIDC) - `BootstrapIdentityService` then
          // just works, no other backend change required for `GlobalUser.displayName`.
          UserAttributes: [
            { Name: "email", Value: input.username },
            { Name: "name", Value: input.name },
          ],
        }),
      );
      return { kind: "CONFIRMATION_REQUIRED" };
    } catch (err) {
      // UsernameExistsException is NOT anti-enumeration-collapsed (unlike every other outcome
      // in this file) - SignUp itself has always had to tell a real user "this e-mail is
      // already registered" for basic usability (the Hosted UI's own signup form did too); this
      // is not a new information leak introduced by this adapter.
      if (err instanceof UsernameExistsException) return { kind: "EMAIL_ALREADY_REGISTERED" };
      if (err instanceof InvalidPasswordException) return { kind: "INVALID_PASSWORD" };
      if (isTransient(err)) return { kind: "TRANSIENT_FAILURE", cause: err };
      return { kind: "UNKNOWN_OUTCOME" };
    }
  }

  async confirmSignUp(input: { username: string; confirmationCode: string }): Promise<CognitoConfirmSignUpOutcome> {
    try {
      await this.client.send(
        new ConfirmSignUpCommand({ ClientId: this.clientId, Username: input.username, ConfirmationCode: input.confirmationCode, SecretHash: this.hash(input.username) }),
      );
      return { kind: "SUCCESS" };
    } catch (err) {
      if (err instanceof CodeMismatchException || err instanceof ExpiredCodeException) return { kind: "INVALID_CODE_OR_EXPIRED" };
      // Only the documented "already confirmed" message maps to that outcome - ANY other
      // NotAuthorizedException (app client misconfiguration, unexpected auth failure) used to
      // be folded into the same false success (round-1 Codex finding).
      if (err instanceof NotAuthorizedException && looksAlreadyConfirmed(err.message)) return { kind: "ALREADY_CONFIRMED" };
      if (isTransient(err)) return { kind: "TRANSIENT_FAILURE", cause: err };
      return { kind: "UNKNOWN_OUTCOME" };
    }
  }

  async resendConfirmationCode(input: { username: string }): Promise<CognitoResendConfirmationOutcome> {
    try {
      await this.client.send(new ResendConfirmationCodeCommand({ ClientId: this.clientId, Username: input.username, SecretHash: this.hash(input.username) }));
      return { kind: "SENT" };
    } catch (err) {
      // Same narrowing as confirmSignUp above (round-1 Codex finding) - only the documented
      // "already confirmed" message maps to that outcome, never every InvalidParameterException.
      if (err instanceof InvalidParameterException && looksAlreadyConfirmed(err.message)) return { kind: "ALREADY_CONFIRMED" };
      // Anti-enumeration (decision 3), same fold as forgotPassword() below - a nonexistent
      // e-mail must resolve identically to a real, unconfirmed one from the caller's point of
      // view. Without this, UserNotFoundException would fall through to UNKNOWN_OUTCOME below
      // and BffAuthService.resendConfirmationCode would surface it as a distinguishable error.
      if (err instanceof UserNotFoundException) return { kind: "SENT" };
      if (isTransient(err)) return { kind: "TRANSIENT_FAILURE", cause: err };
      return { kind: "UNKNOWN_OUTCOME" };
    }
  }

  async forgotPassword(input: { username: string }): Promise<CognitoForgotPasswordOutcome> {
    try {
      await this.client.send(new ForgotPasswordCommand({ ClientId: this.clientId, Username: input.username, SecretHash: this.hash(input.username) }));
      return { kind: "SUCCESS" };
    } catch (err) {
      // UserNotFoundException is swallowed into SUCCESS on purpose (D-3xx decision 3) - under
      // `prevent_user_existence_errors = "ENABLED"` Cognito itself normally never throws this
      // for ForgotPassword in the first place, but this adapter does not rely on that alone.
      // InvalidParameterException is folded the same way (round-1 Codex finding, AWS's own docs
      // on error suppression) - a user with no verified recovery attribute (email/phone) also
      // throws this, which would otherwise create a 3-way oracle (real send=202, no-such-user=
      // 202, "exists but nothing to send to"=503) distinguishable without any timing measurement.
      if (err instanceof UserNotFoundException || err instanceof InvalidParameterException) return { kind: "SUCCESS" };
      if (isTransient(err)) return { kind: "TRANSIENT_FAILURE", cause: err };
      return { kind: "UNKNOWN_OUTCOME" };
    }
  }

  async confirmForgotPassword(input: { username: string; confirmationCode: string; newPassword: string }): Promise<CognitoConfirmForgotPasswordOutcome> {
    try {
      await this.client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          Username: input.username,
          ConfirmationCode: input.confirmationCode,
          Password: input.newPassword,
          SecretHash: this.hash(input.username),
        }),
      );
      return { kind: "SUCCESS" };
    } catch (err) {
      if (err instanceof CodeMismatchException || err instanceof ExpiredCodeException) return { kind: "INVALID_CODE_OR_EXPIRED" };
      if (err instanceof UserNotFoundException) return { kind: "INVALID_CODE_OR_EXPIRED" }; // never distinguish from a bad code (anti-enumeration)
      if (err instanceof InvalidPasswordException) return { kind: "INVALID_PASSWORD" };
      if (isTransient(err)) return { kind: "TRANSIENT_FAILURE", cause: err };
      return { kind: "UNKNOWN_OUTCOME" };
    }
  }
}

export function createCognitoIdpClient(): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({});
}
