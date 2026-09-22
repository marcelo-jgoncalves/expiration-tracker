/**
 * Real ID token verifier using aws-jwt-verify (already a dependency, unused until now - it
 * was added in anticipation of exactly this: signature + issuer + audience verification, plus
 * a customJwtCheck hook for the nonce, which Cognito's own claim set doesn't validate for you.
 */
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { AuthenticationError } from "../../../shared/errors/app-error.js";
import type { IdTokenVerifier } from "../ports/cognito-oidc-client.js";

export class AwsJwtIdTokenVerifier implements IdTokenVerifier {
  private readonly verifier;

  constructor(userPoolId: string, clientId: string) {
    this.verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: "id", clientId });
  }

  async verify(idToken: string, expectedNonce: string | undefined): Promise<{ subject: string; email?: string; name?: string }> {
    try {
      const payload = await this.verifier.verify(idToken, {
        // D-3xx: `expectedNonce` is undefined for the direct-auth path (InitiateAuth's ID
        // token was never minted against an /oauth2/authorize nonce) - skip the check rather
        // than compare against `undefined`, which would fail every such token.
        customJwtCheck:
          expectedNonce === undefined
            ? undefined
            : ({ payload }) => {
                if (payload["nonce"] !== expectedNonce) {
                  throw new Error("nonce mismatch");
                }
              },
      });
      const email = typeof payload["email"] === "string" ? payload["email"] : undefined;
      const name = typeof payload["name"] === "string" ? payload["name"] : undefined;
      return { subject: payload.sub, email, name };
    } catch (cause) {
      throw new AuthenticationError("ID token verification failed.", { cause: String(cause) });
    }
  }
}
