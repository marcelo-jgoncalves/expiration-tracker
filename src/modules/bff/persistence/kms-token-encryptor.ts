/**
 * Real KMS adapter for refresh-token encryption at rest (D-054: mandatory, dedicated CMK -
 * never the fake/no-op used in tests). Encrypt/Decrypt use the CMK's key policy for access
 * control - the BFF Lambda's role needs kms:Encrypt/kms:Decrypt/kms:GenerateDataKey scoped to
 * exactly this key (infra/modules/bff-session-table).
 */
import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import type { TokenEncryptor } from "../ports/token-encryptor.js";

export class KmsTokenEncryptor implements TokenEncryptor {
  constructor(
    private readonly client: KMSClient,
    private readonly keyId: string,
  ) {}

  async encrypt(plaintext: string): Promise<string> {
    const result = await this.client.send(new EncryptCommand({ KeyId: this.keyId, Plaintext: Buffer.from(plaintext, "utf-8") }));
    if (!result.CiphertextBlob) {
      throw new Error("KMS Encrypt returned no CiphertextBlob.");
    }
    return Buffer.from(result.CiphertextBlob).toString("base64");
  }

  async decrypt(ciphertext: string): Promise<string> {
    const result = await this.client.send(new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: Buffer.from(ciphertext, "base64") }));
    if (!result.Plaintext) {
      throw new Error("KMS Decrypt returned no Plaintext.");
    }
    return Buffer.from(result.Plaintext).toString("utf-8");
  }
}

export function createKmsClient(): KMSClient {
  return new KMSClient({});
}
