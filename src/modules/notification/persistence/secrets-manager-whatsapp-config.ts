/**
 * D-197 fatia 3/5 (D-10) - first external-vendor secret in this repo. Replaces the plain-env-var
 * credential source `whatsapp-cloud-api-adapter.ts`'s header comment named as a fatia 2/5
 * placeholder (`WhatsAppCloudApiConfig` itself is UNCHANGED - this file only changes where the
 * composition root gets the values from). IAM for `secretsmanager:GetSecretValue` is scoped
 * (`infra/modules/whatsapp-secrets/`) to only the 2 Lambdas that need it: this delivery worker
 * and the webhook handler (which needs `appSecret`/`verifyToken` for signature/challenge
 * verification, never the access token).
 *
 * One JSON secret, not five separate ones: Meta issues these five values together (Business
 * Manager app config + phone number provisioning) and every consumer of one needs the others for
 * context (e.g. classifying a Cloud API error still wants `phoneNumberId` in scope) - splitting
 * them would multiply `GetSecretValue` calls and IAM resource ARNs for no isolation benefit
 * (nothing here can be rotated independently of the others; the app secret and access token are
 * both issued from the same Meta App at once).
 *
 * Secrets are NEVER logged - `SecureLogger`'s redaction rules cover unknown fields defensively,
 * but this reader additionally never returns the raw `GetSecretValueCommand` response, only the
 * parsed, typed config object, and never includes it in a thrown error's message.
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export interface WhatsAppSecrets {
  accessToken: string;
  appSecret: string;
  phoneNumberId: string;
  wabaId: string;
  verifyToken: string;
}

interface RawWhatsAppSecretJson {
  accessToken?: string;
  appSecret?: string;
  phoneNumberId?: string;
  wabaId?: string;
  verifyToken?: string;
}

export function createSecretsManagerClient(): SecretsManagerClient {
  return new SecretsManagerClient({});
}

/**
 * Reads and parses the WhatsApp Cloud API secret once per cold start (Lambda execution
 * environments are reused across invocations - this is deliberately NOT re-fetched per
 * invocation, same amortization posture as `AppConfigFeatureFlagsReader`'s session token, just
 * simpler since Secrets Manager has no polling protocol). Throws (never returns a partial/
 * placeholder config) if the secret is missing, unparseable, or missing any required field - a
 * cold start that can't read its own credentials should fail loudly, not silently degrade to an
 * empty-string token that would fail every send as a confusing 401 far from the real cause.
 */
export async function loadWhatsAppSecrets(client: SecretsManagerClient, secretId: string): Promise<WhatsAppSecrets> {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) {
    throw new Error("WhatsApp secret has no SecretString (binary secrets are not supported).");
  }
  let parsed: RawWhatsAppSecretJson;
  try {
    parsed = JSON.parse(result.SecretString) as RawWhatsAppSecretJson;
  } catch {
    // Never include the raw SecretString in the error - even a parse-failure message must not
    // risk echoing secret material into logs.
    throw new Error("WhatsApp secret is not valid JSON.");
  }
  const { accessToken, appSecret, phoneNumberId, wabaId, verifyToken } = parsed;
  if (!accessToken || !appSecret || !phoneNumberId || !wabaId || !verifyToken) {
    throw new Error("WhatsApp secret is missing one or more required fields (accessToken/appSecret/phoneNumberId/wabaId/verifyToken).");
  }
  return { accessToken, appSecret, phoneNumberId, wabaId, verifyToken };
}
