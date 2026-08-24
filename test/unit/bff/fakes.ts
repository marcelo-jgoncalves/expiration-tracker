import type { CognitoOidcClient, CognitoRefreshOutcome, CognitoTokenResponse, IdTokenVerifier } from "../../../src/modules/bff/ports/cognito-oidc-client.js";
import type { TokenEncryptor } from "../../../src/modules/bff/ports/token-encryptor.js";

/** BffAuthService decodes (never verifies) the access token's payload segment - the fake
 * must produce a real 3-segment JWT shape, not an arbitrary string, or that decode throws. */
export function fakeAccessToken(claims: Record<string, unknown> = {}): string {
  const payload = Buffer.from(JSON.stringify({ sub: "cognito-sub-1", jti: "jti-1", iat: 1, exp: 2, ...claims })).toString("base64url");
  return `header.${payload}.signature`;
}

/** Deterministic in-memory Cognito fake. Test cases mutate `nextRefreshOutcome`/
 * `exchangeShouldFail` to drive specific scenarios instead of hitting real Cognito. */
export class FakeCognitoOidcClient implements CognitoOidcClient {
  exchangeCalls: { code: string; codeVerifier: string; redirectUri: string }[] = [];
  refreshCalls: { refreshToken: string }[] = [];
  revokeCalls: { refreshToken: string }[] = [];
  nextRefreshOutcome: CognitoRefreshOutcome = { kind: "SUCCESS", response: { accessToken: fakeAccessToken({ jti: "jti-2" }), idToken: "id-2", refreshToken: "refresh-2", expiresInSeconds: 900 } };
  refreshShouldThrow = false;
  /** Test-only seam: runs right before refreshAccessToken returns, simulating a concurrent
   * mutation (e.g. a logout) that lands while the BFF is mid-flight talking to Cognito - the
   * exact window the refresh lease's final commit needs to stay safe across. */
  onBeforeRefreshReturns?: () => Promise<void> | void;

  async exchangeAuthorizationCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<CognitoTokenResponse> {
    this.exchangeCalls.push(input);
    return { accessToken: fakeAccessToken(), idToken: "id-1", refreshToken: "refresh-1", expiresInSeconds: 900 };
  }

  async refreshAccessToken(input: { refreshToken: string }): Promise<CognitoRefreshOutcome> {
    this.refreshCalls.push(input);
    if (this.refreshShouldThrow) throw new Error("simulated network failure");
    await this.onBeforeRefreshReturns?.();
    return this.nextRefreshOutcome;
  }

  async revokeRefreshToken(input: { refreshToken: string }): Promise<void> {
    this.revokeCalls.push(input);
  }
}

export class FakeIdTokenVerifier implements IdTokenVerifier {
  nextResult: { subject: string; email?: string } = { subject: "cognito-sub-1", email: "user@example.com" };
  shouldThrow = false;
  lastCall?: { idToken: string; expectedNonce: string };

  async verify(idToken: string, expectedNonce: string): Promise<{ subject: string; email?: string }> {
    this.lastCall = { idToken, expectedNonce };
    if (this.shouldThrow) throw new Error("nonce mismatch");
    return this.nextResult;
  }
}

/** Reversible XOR-with-fixed-key "encryption" - good enough to prove ciphertext != plaintext
 * and round-trips correctly, without pulling in real KMS for unit tests. */
export class FakeTokenEncryptor implements TokenEncryptor {
  async encrypt(plaintext: string): Promise<string> {
    return Buffer.from(plaintext, "utf-8").toString("base64") + ".enc";
  }
  async decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext.endsWith(".enc")) throw new Error("not encrypted by this fake");
    return Buffer.from(ciphertext.slice(0, -4), "base64").toString("utf-8");
  }
}
