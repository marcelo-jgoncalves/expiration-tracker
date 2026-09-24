/**
 * Adapter-level tests for CognitoIdpAuthClient - round-2 Codex finding
 * (d321-direct-auth-adversarial-review): the handler-level tests exercise `FakeCognitoAuthClient`
 * (a hand-written stand-in), which never runs `looksAlreadyConfirmed()` or the
 * `forgotPassword`/`InvalidParameterException` fold at all - a regression in either could pass
 * every existing test. These mock the real `CognitoIdentityProviderClient.send()` to throw the
 * REAL AWS SDK exception classes, exercising the actual mapping logic in this file.
 */
import { describe, expect, it } from "vitest";
import { NotAuthorizedException, InvalidParameterException, UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";
import { CognitoIdpAuthClient } from "../../../src/modules/bff/persistence/cognito-idp-auth-client.js";

function buildClient(send: (command: unknown) => Promise<unknown>) {
  const fakeSdkClient = { send } as unknown as import("@aws-sdk/client-cognito-identity-provider").CognitoIdentityProviderClient;
  return new CognitoIdpAuthClient(fakeSdkClient, "client-1", "secret-1");
}

describe("CognitoIdpAuthClient.confirmSignUp", () => {
  it("maps a NotAuthorizedException with the documented 'already confirmed' message to ALREADY_CONFIRMED", async () => {
    const client = buildClient(async () => {
      throw new NotAuthorizedException({ message: "User cannot be confirmed. Current status is CONFIRMED", $metadata: {} });
    });
    const outcome = await client.confirmSignUp({ username: "user@example.com", confirmationCode: "123456" });
    expect(outcome.kind).toBe("ALREADY_CONFIRMED");
  });

  // Round-2 Codex finding: this is the exact regression the Rodada 1 bug allowed - ANY
  // NotAuthorizedException (e.g. a genuine app-client authorization failure) used to be silently
  // reported as ALREADY_CONFIRMED (a false success) regardless of its message.
  it("does NOT map an unrelated NotAuthorizedException to ALREADY_CONFIRMED", async () => {
    const client = buildClient(async () => {
      throw new NotAuthorizedException({ message: "Unable to verify secret hash for client.", $metadata: {} });
    });
    const outcome = await client.confirmSignUp({ username: "user@example.com", confirmationCode: "123456" });
    expect(outcome.kind).toBe("UNKNOWN_OUTCOME");
  });

  it("still maps CodeMismatchException to INVALID_CODE_OR_EXPIRED", async () => {
    const { CodeMismatchException } = await import("@aws-sdk/client-cognito-identity-provider");
    const client = buildClient(async () => {
      throw new CodeMismatchException({ message: "Invalid code.", $metadata: {} });
    });
    const outcome = await client.confirmSignUp({ username: "user@example.com", confirmationCode: "000000" });
    expect(outcome.kind).toBe("INVALID_CODE_OR_EXPIRED");
  });

  it("still maps ExpiredCodeException to INVALID_CODE_OR_EXPIRED", async () => {
    const { ExpiredCodeException } = await import("@aws-sdk/client-cognito-identity-provider");
    const client = buildClient(async () => {
      throw new ExpiredCodeException({ message: "Code expired.", $metadata: {} });
    });
    const outcome = await client.confirmSignUp({ username: "user@example.com", confirmationCode: "000000" });
    expect(outcome.kind).toBe("INVALID_CODE_OR_EXPIRED");
  });
});

describe("CognitoIdpAuthClient.resendConfirmationCode", () => {
  it("maps an InvalidParameterException with the documented 'already confirmed' message to ALREADY_CONFIRMED", async () => {
    const client = buildClient(async () => {
      throw new InvalidParameterException({ message: "User is already confirmed.", $metadata: {} });
    });
    const outcome = await client.resendConfirmationCode({ username: "user@example.com" });
    expect(outcome.kind).toBe("ALREADY_CONFIRMED");
  });

  it("does NOT map an unrelated InvalidParameterException to ALREADY_CONFIRMED", async () => {
    const client = buildClient(async () => {
      throw new InvalidParameterException({ message: "Attribute request is malformed.", $metadata: {} });
    });
    const outcome = await client.resendConfirmationCode({ username: "user@example.com" });
    expect(outcome.kind).toBe("UNKNOWN_OUTCOME");
  });

  it("still maps UserNotFoundException to SENT (anti-enumeration)", async () => {
    const client = buildClient(async () => {
      throw new UserNotFoundException({ message: "User does not exist.", $metadata: {} });
    });
    const outcome = await client.resendConfirmationCode({ username: "nobody@example.com" });
    expect(outcome.kind).toBe("SENT");
  });
});

describe("CognitoIdpAuthClient.forgotPassword", () => {
  it("maps InvalidParameterException to SUCCESS (round-2 Codex finding - closes the 3-way anti-enumeration oracle)", async () => {
    const client = buildClient(async () => {
      throw new InvalidParameterException({ message: "Cannot reset password for the user as there is no registered/verified email or phone_number", $metadata: {} });
    });
    const outcome = await client.forgotPassword({ username: "user@example.com" });
    expect(outcome.kind).toBe("SUCCESS");
  });

  it("still maps UserNotFoundException to SUCCESS", async () => {
    const client = buildClient(async () => {
      throw new UserNotFoundException({ message: "User does not exist.", $metadata: {} });
    });
    const outcome = await client.forgotPassword({ username: "nobody@example.com" });
    expect(outcome.kind).toBe("SUCCESS");
  });

  it("maps a genuinely transient error to TRANSIENT_FAILURE, never SUCCESS", async () => {
    const client = buildClient(async () => {
      throw new Error("ECONNRESET");
    });
    const outcome = await client.forgotPassword({ username: "user@example.com" });
    expect(outcome.kind).toBe("TRANSIENT_FAILURE");
  });
});

describe("CognitoIdpAuthClient - SECRET_HASH", () => {
  it("computes SECRET_HASH via HMAC-SHA256(clientSecret, username + clientId)", async () => {
    let capturedCommand: { input?: { AuthParameters?: Record<string, string> } } | undefined;
    const client = buildClient(async (command) => {
      capturedCommand = command as typeof capturedCommand;
      throw new NotAuthorizedException({ message: "Incorrect username or password.", $metadata: {} });
    });
    await client.authenticateWithPassword({ username: "user@example.com", password: "x" });
    const secretHash = capturedCommand?.input?.AuthParameters?.["SECRET_HASH"];
    expect(secretHash).toBeTruthy();

    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", "secret-1").update("user@example.com" + "client-1").digest("base64");
    expect(secretHash).toBe(expected);
  });

  it("never includes the raw client secret in a thrown outcome", async () => {
    const client = buildClient(async () => {
      throw new NotAuthorizedException({ message: "Incorrect username or password.", $metadata: {} });
    });
    const outcome = await client.authenticateWithPassword({ username: "user@example.com", password: "x" });
    expect(JSON.stringify(outcome)).not.toContain("secret-1");
  });
});
