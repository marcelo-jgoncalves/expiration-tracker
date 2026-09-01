/**
 * Real Cognito OAuth2/OIDC adapter - plain `fetch` against the Hosted UI's `/oauth2/token`
 * and `/oauth2/revoke` endpoints (Node has native fetch since v18, no HTTP client dependency
 * needed). client_secret is passed as an env var (Terraform `sensitive = true`), same
 * pattern as GUEST_TOKEN_PEPPER - never Secrets Manager, no precedent for it in this project.
 */
import type { CognitoOidcClient, CognitoRefreshOutcome, CognitoTokenResponse } from "../ports/cognito-oidc-client.js";

export class FetchCognitoOidcClient implements CognitoOidcClient {
  constructor(
    private readonly domain: string, // e.g. https://<prefix>.auth.<region>.amazoncognito.com
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private basicAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
  }

  async exchangeAuthorizationCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<CognitoTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.clientId,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
    const res = await fetch(`${this.domain}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: this.basicAuthHeader() },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Cognito token exchange failed: ${res.status}`);
    }
    const json = (await res.json()) as { access_token: string; id_token: string; refresh_token: string; expires_in: number };
    return { accessToken: json.access_token, idToken: json.id_token, refreshToken: json.refresh_token, expiresInSeconds: json.expires_in };
  }

  async refreshAccessToken(input: { refreshToken: string }): Promise<CognitoRefreshOutcome> {
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: this.clientId, refresh_token: input.refreshToken });
    let res: Response;
    try {
      res = await fetch(`${this.domain}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: this.basicAuthHeader() },
        body: body.toString(),
      });
    } catch (cause) {
      return { kind: "TRANSIENT_FAILURE", cause };
    }

    if (res.status >= 500) {
      return { kind: "TRANSIENT_FAILURE", cause: undefined };
    }
    if (res.status === 400) {
      let payload: { error?: string } = {};
      try {
        payload = (await res.json()) as { error?: string };
      } catch {
        return { kind: "UNKNOWN_OUTCOME" };
      }
      if (payload.error === "invalid_grant") {
        return { kind: "INVALID_GRANT" };
      }
      return { kind: "UNKNOWN_OUTCOME" };
    }
    if (!res.ok) {
      return { kind: "UNKNOWN_OUTCOME" };
    }

    let json: { access_token: string; id_token: string; refresh_token?: string; expires_in: number };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      return { kind: "UNKNOWN_OUTCOME" };
    }
    return {
      kind: "SUCCESS",
      response: {
        accessToken: json.access_token,
        idToken: json.id_token,
        // Cognito's native RefreshTokenRotation (D-054) returns a NEW refresh_token on every
        // successful call; if it were ever absent (rotation disabled), fall back to the old
        // one rather than crash - callers always overwrite the stored value either way.
        refreshToken: json.refresh_token ?? input.refreshToken,
        expiresInSeconds: json.expires_in,
      },
    };
  }

  async revokeRefreshToken(input: { refreshToken: string }): Promise<void> {
    const body = new URLSearchParams({ token: input.refreshToken, client_id: this.clientId });
    await fetch(`${this.domain}/oauth2/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: this.basicAuthHeader() },
      body: body.toString(),
    });
  }
}
