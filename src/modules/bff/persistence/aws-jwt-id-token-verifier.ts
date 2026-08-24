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

  async verify(idToken: string, expectedNonce: string): Promise<{ subject: string; email?: string }> {
    try {
      const payload = await this.verifier.verify(idToken, {
        customJwtCheck: ({ payload }) => {
          if (payload["nonce"] !== expectedNonce) {
            throw new Error("nonce mismatch");
          }
        },
      });
      const email = typeof payload["email"] === "string" ? payload["email"] : undefined;
      return { subject: payload.sub, email };
    } catch (cause) {
      throw new AuthenticationError("ID token verification failed.", { cause: String(cause) });
    }
  }
}
