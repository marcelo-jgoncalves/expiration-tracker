/**
 * Real KMS adapter for the Step Functions task-token ciphertext (`TextractJob.taskTokenCiphertext`).
 * Structurally identical to `src/modules/bff/persistence/kms-token-encryptor.ts` (same
 * envelope-encryption pattern, D-054), but declared/instantiated independently per the module
 * boundary discipline documented in `ports/task-token-encryptor.ts` — extraction and bff stay
 * independently deployable/testable, each against its OWN dedicated CMK (never sharing a key,
 * so a compromise/rotation of one credential class never touches the other).
 */
import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import type { TaskTokenEncryptor } from "../ports/task-token-encryptor.js";

export class KmsTaskTokenEncryptor implements TaskTokenEncryptor {
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
